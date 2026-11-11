// Alerts on charts: the value an alert watches, its condition in words, incidents and their webhooks.
import { randomId } from '../crypto.js';
import { bySourceId } from '../query/sources.js';
import { getStorage } from '../storage/index.js';

export const MINUTE = 60_000;
export const WINDOWS = [5, 15, 30, 45, 60];
/** 5 or 15 minutes, or whole hours up to 24. */
export const QUIET_MINUTES = [5, 15, ...Array.from({ length: 24 }, (_, i) => (i + 1) * 60)];
export const DEFAULT_QUIET_MINUTES = 5;
/** With no logs to measure (average, p95), an open incident resolves after 1 to 24 hours. */
export const NO_DATA_MINUTES = Array.from({ length: 24 }, (_, i) => (i + 1) * 60);
export const DEFAULT_NO_DATA_MINUTES = 60;
// Logs reach Basin 1.5–3.5 minutes after they're sent, so each check looks at a period that ended 5 minutes ago.
export const SETTLE_MS = 5 * MINUTE;
const WEBHOOK_TIMEOUT_MS = 10_000;

/** An alert joined with what it needs from its chart and project. */
export const ALERT_SELECT = `SELECT a.*, c.title AS chart_title, c.filter_json, c.field, c.measure, c.dashboard_id,
  p.name AS project_name
  FROM alerts a JOIN charts c ON c.id = a.chart_id JOIN projects p ON p.id = a.project_id`;

/**
 * @typedef {{ id: string, chart_id: string, project_id: string, name: string, kind: 'above' | 'increase',
 *   threshold: number, window_minutes: number, quiet_minutes: number, no_data_minutes: number,
 *   webhook_url: string, paused: number,
 *   quiet_until: number, created_at: number, updated_at: number, chart_title: string, filter_json: string,
 *   field: string | null, measure: string, dashboard_id: string, project_name: string }} AlertRow
 * @typedef {{ id: string, alert_id: string, started_at: number, value: number, previous: number | null,
 *   last_data_at: number,
 *   resolved_at: number | null, resolved_by: string | null, opened_webhook: string | null,
 *   resolved_webhook: string | null }} Incident
 */

/** @param {number} n */
const round = (n) => Math.round(n * 100) / 100;

/** What the alert measures, in words: "logs", "average duration_ms", "p95 duration_ms". @param {AlertRow} a */
function measured(a) {
  const field = String(a.field ?? '').replace(/^fields\./, '');
  if (a.measure === 'avg') return `average ${field}`;
  if (a.measure === 'p95') return `p95 ${field}`;
  return 'logs';
}

/**
 * The same wording as the alert form: "Logs above 5 in the last 15 min",
 * "Average duration_ms up 50% compared with the 15 min before".
 */
export function conditionText(/** @type {AlertRow} */ a) {
  const what = measured(a);
  // Sentence case, except "p95", which is always written in lowercase.
  const What = what.startsWith('p95') ? what : what[0].toUpperCase() + what.slice(1);
  if (a.kind === 'increase')
    return `${What} up ${a.threshold}% compared with the ${a.window_minutes} min before`;
  return `${What} above ${a.threshold} in the last ${a.window_minutes} min`;
}

/** A chart filter as one line of search text, as typed in live tail, e.g. `level:error run:abc`. */
export function filterText(/** @type {any[]} */ where) {
  const quote = (/** @type {unknown} */ v) =>
    /[\s"]/.test(String(v)) ? `"${String(v).replaceAll('"', '')}"` : String(v);
  return where
    .map((c) => {
      if ('text' in c) return c.text;
      const name = String(c.field).replace(/^fields\./, '');
      if (c.op === 'exists') return `${name}:*`;
      if (c.op === 'in' || c.op === 'not_in') {
        return `${name}:${c.op === 'not_in' ? '!' : ''}${c.value.map(quote).join(',')}`;
      }
      const prefix =
        { '!=': '!', '>': '>', '>=': '>=', '<': '<', '<=': '<=' }[/** @type {string} */ (c.op)] ?? '';
      return `${name}:${prefix}${quote(c.value)}`;
    })
    .join(' ');
}

/** @param {AlertRow} a @param {{ id: string, resolved_at: number | null } | null} [open] */
export function alertOut(a, open = null) {
  return {
    id: a.id,
    chart_id: a.chart_id,
    project_id: a.project_id,
    name: a.name,
    kind: a.kind,
    threshold: a.threshold,
    window_minutes: a.window_minutes,
    quiet_minutes: a.quiet_minutes,
    no_data_minutes: a.no_data_minutes,
    webhook_url: a.webhook_url,
    paused: Boolean(a.paused),
    quiet_until: a.quiet_until,
    created_at: a.created_at,
    updated_at: a.updated_at,
    chart_title: a.chart_title,
    dashboard_id: a.dashboard_id,
    measure: a.measure,
    field: a.field,
    condition: conditionText(a),
    open_incident: open,
  };
}

/**
 * The chart's value from `from` to `to`, exactly as the chart computes it (same filter, same measure).
 * Grouped charts give their total. Returns null when an average or p95 has no data.
 * @param {Env} env
 * @param {Map<string, string>} names  the project's source names by id
 * @param {AlertRow} a
 * @param {number} from
 * @param {number} to
 */
export async function chartValue(env, names, a, from, to) {
  const where = JSON.parse(a.filter_json).where ?? [];
  const filter = bySourceId({ project_id: a.project_id, from, to, where, limit: 1, cursor: null }, names);
  const counting = a.measure === 'count' || a.measure === 'count_over_time';
  const spec = {
    measure: /** @type {'count' | 'avg' | 'p95'} */ (counting ? 'count' : a.measure),
    field: counting ? undefined : (a.field ?? undefined),
    interval: MINUTE,
    parts: ['value'],
  };
  const { value } = await getStorage(env).aggregate(filter, spec);
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Whether the condition holds. An increase needs a previous value above zero to compare with.
 * @param {AlertRow} a @param {number} value @param {number | null} previous
 */
export function holds(a, value, previous) {
  if (a.kind === 'above') return value > a.threshold;
  return previous !== null && previous > 0 && ((value - previous) / previous) * 100 >= a.threshold;
}

/**
 * Opens an incident unless one is already open (the unique index allows only one). Returns it, or null.
 * @param {Env} env @param {AlertRow} a @param {number} value @param {number | null} previous
 * @returns {Promise<Incident | null>}
 */
export async function openIncident(env, a, value, previous) {
  /** @type {Incident} */
  const incident = {
    id: randomId('inc'),
    alert_id: a.id,
    started_at: Date.now(),
    value: round(value),
    previous: previous === null ? null : round(previous),
    last_data_at: Date.now(),
    resolved_at: null,
    resolved_by: null,
    opened_webhook: null,
    resolved_webhook: null,
  };
  try {
    // Only while the alert still exists and isn't paused (it may have changed since the check read it).
    const res = await env.DB.prepare(
      `INSERT INTO incidents (id, alert_id, started_at, value, previous, last_data_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM alerts WHERE id = ? AND paused = 0)`,
    )
      .bind(
        incident.id,
        a.id,
        incident.started_at,
        incident.value,
        incident.previous,
        incident.started_at,
        a.id,
      )
      .run();
    if (!res.meta.changes) return null;
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return null;
    throw err;
  }
  return incident;
}

/**
 * Resolves an open incident and starts the alert's quiet time. Returns the resolved incident, or null when it
 * was already resolved (by another check or another click).
 * @param {Env} env @param {AlertRow} a @param {Incident} incident @param {'auto' | 'no_data' | 'manual' | 'paused'} by
 * @returns {Promise<Incident | null>}
 */
export async function resolveIncident(env, a, incident, by) {
  const now = Date.now();
  const res = await env.DB.prepare(
    'UPDATE incidents SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL',
  )
    .bind(now, by, incident.id)
    .run();
  if (!res.meta.changes) return null;
  await env.DB.prepare('UPDATE alerts SET quiet_until = ? WHERE id = ?')
    .bind(now + a.quiet_minutes * MINUTE, a.id)
    .run();
  return { ...incident, resolved_at: now, resolved_by: by };
}

/** @param {Env} env @param {string} alertId */
export async function openIncidentOf(env, alertId) {
  return /** @type {Incident | null} */ (
    await env.DB.prepare('SELECT * FROM incidents WHERE alert_id = ? AND resolved_at IS NULL')
      .bind(alertId)
      .first()
  );
}

/** The app's address for links in webhooks, saved whenever an alert is saved. @param {Env} env */
export async function appUrl(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'app_url'").first();
  return row ? String(row.value) : '';
}

/**
 * POSTs JSON to a webhook once. Returns the status code, or "failed: …".
 * @param {string} url @param {unknown} payload
 */
export async function postWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Open Logs' },
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return String(res.status);
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return 'failed: timeout';
    return `failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`;
  }
}

/**
 * The webhook body: one flat object. Times are ISO strings in UTC.
 * @param {AlertRow} a @param {Incident} incident @param {'incident.opened' | 'incident.resolved'} type
 * @param {string | undefined} resolvedBy @param {string} base  the app's address, for the link
 * @param {number} [now]
 */
export function webhookPayload(a, incident, type, resolvedBy, base, now = Date.now()) {
  const resolvedAt = type === 'incident.resolved' ? (incident.resolved_at ?? now) : null;
  const iso = (/** @type {number} */ t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    type,
    incident_id: incident.id,
    alert_id: a.id,
    alert_name: a.name,
    condition: conditionText(a),
    chart_id: a.chart_id,
    chart_title: a.chart_title,
    filter: filterText(JSON.parse(a.filter_json).where ?? []),
    project_id: a.project_id,
    project_name: a.project_name,
    value: incident.value,
    started_at: iso(incident.started_at),
    resolved_at: resolvedAt === null ? null : iso(resolvedAt),
    resolved_by: resolvedAt === null ? null : (resolvedBy ?? incident.resolved_by),
    duration_seconds:
      resolvedAt === null ? 0 : Math.max(0, Math.round((resolvedAt - incident.started_at) / 1000)),
    url: base
      ? `${base}/alert?project=${encodeURIComponent(a.project_id)}&id=${encodeURIComponent(a.id)}`
      : null,
  };
}

/**
 * Sends the incident's webhook and stores the result on it.
 * @param {Env} env @param {AlertRow} a @param {Incident} incident
 * @param {'incident.opened' | 'incident.resolved'} type
 * @param {string} [resolvedBy]  overrides the reason, e.g. "deleted" when the alert itself goes away
 * @param {boolean} [store]  false when the incident row is being deleted
 */
export async function notify(env, a, incident, type, resolvedBy, store = true) {
  const result = await postWebhook(
    a.webhook_url,
    webhookPayload(a, incident, type, resolvedBy, await appUrl(env)),
  );
  if (!store) return;
  const column = type === 'incident.opened' ? 'opened_webhook' : 'resolved_webhook';
  await env.DB.prepare(`UPDATE incidents SET ${column} = ? WHERE id = ?`).bind(result, incident.id).run();
}

/**
 * Before alerts are deleted with their chart, dashboard or project: sends "resolved" for their open incidents.
 * Returns the sending as a promise for `waitUntil`; the incidents themselves go with the delete.
 * @param {Env} env @param {'a.chart_id' | 'c.dashboard_id' | 'a.project_id'} column @param {string} id
 */
export async function closeBeforeDelete(env, column, id) {
  const { results } = await env.DB.prepare(
    `${ALERT_SELECT} WHERE ${column} = ?
     AND EXISTS (SELECT 1 FROM incidents i WHERE i.alert_id = a.id AND i.resolved_at IS NULL)`,
  )
    .bind(id)
    .all();
  const alerts = /** @type {AlertRow[]} */ (/** @type {unknown} */ (results));
  const pending = await Promise.all(
    alerts.map(async (a) => ({ a, incident: await openIncidentOf(env, a.id) })),
  );
  return () =>
    Promise.all(
      pending.map(({ a, incident }) =>
        incident ? notify(env, a, incident, 'incident.resolved', 'deleted', false) : null,
      ),
    );
}
