// Alerts on charts, their incidents, and the webhook test.
import {
  ALERT_SELECT,
  alertOut,
  closeBeforeDelete,
  DEFAULT_QUIET_MINUTES,
  notify,
  openIncidentOf,
  postWebhook,
  QUIET_MINUTES,
  resolveIncident,
  WINDOWS,
} from '../alerts/alerts.js';
import { randomId } from '../crypto.js';
import { asObject, HttpError, json, readJson, requireString } from '../http.js';
import { findProject, PAGE_SIZE } from './projects.js';

/** @typedef {import('../alerts/alerts.js').AlertRow} AlertRow */
/** @typedef {import('../alerts/alerts.js').Incident} Incident */

/** @param {string} field @param {string} message */
const invalid = (field, message) => new HttpError(400, 'invalid_field', message, { field });

/** @param {unknown} raw */
function parseWebhookUrl(raw) {
  const value = requireString(raw, 'webhook_url', { max: 2000 });
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalid('webhook_url', 'Enter a webhook URL starting with https://');
  }
  if (url.protocol !== 'https:') throw invalid('webhook_url', 'Enter a webhook URL starting with https://');
  return url.toString();
}

/** @param {Record<string, unknown>} body */
function parseAlert(body) {
  const name = requireString(body.name, 'name', { max: 100 });
  const kind = String(body.kind);
  if (kind !== 'above' && kind !== 'increase') throw invalid('kind', 'kind must be above or increase');
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1e12) {
    throw invalid('threshold', 'Enter a number above 0');
  }
  const window = Number(body.window_minutes);
  if (!WINDOWS.includes(window))
    throw invalid('window_minutes', 'window_minutes must be 5, 15, 30, 45 or 60');
  const quiet = body.quiet_minutes === undefined ? DEFAULT_QUIET_MINUTES : Number(body.quiet_minutes);
  if (!QUIET_MINUTES.includes(quiet)) {
    throw invalid('quiet_minutes', 'quiet_minutes must be 5, 15, or whole hours from 60 to 1440');
  }
  return { name, kind, threshold, window, quiet, webhook: parseWebhookUrl(body.webhook_url) };
}

/** @param {Env} env @param {string} chartId */
async function findChartProject(env, chartId) {
  const row = await env.DB.prepare(
    'SELECT c.id, d.project_id FROM charts c JOIN dashboards d ON d.id = c.dashboard_id WHERE c.id = ?',
  )
    .bind(chartId)
    .first();
  if (!row) throw new HttpError(404, 'not_found', 'Chart not found');
  return { chartId: String(row.id), projectId: String(row.project_id) };
}

/** @param {Env} env @param {string} column @param {string} id */
async function findAlert(env, column, id) {
  const a = await env.DB.prepare(`${ALERT_SELECT} WHERE ${column} = ?`).bind(id).first();
  return /** @type {AlertRow | null} */ (/** @type {unknown} */ (a));
}

/** @param {Env} env @param {string} id */
async function mustFindAlert(env, id) {
  const a = await findAlert(env, 'a.id', id);
  if (!a) throw new HttpError(404, 'not_found', 'Alert not found');
  return a;
}

/** @param {import('../types.js').RouteContext} c */
export async function getChartAlert({ env, params }) {
  await findChartProject(env, params.id);
  const a = await findAlert(env, 'a.chart_id', params.id);
  return json({ alert: a ? alertOut(a, await openIncidentOf(env, a.id)) : null });
}

/** Creates or replaces the chart's alert. @param {import('../types.js').RouteContext} c */
export async function putChartAlert({ request, env, params, url }) {
  const { chartId, projectId } = await findChartProject(env, params.id);
  const v = parseAlert(asObject(await readJson(request)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO alerts (id, chart_id, project_id, name, kind, threshold, window_minutes, quiet_minutes,
         webhook_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chart_id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
         threshold = excluded.threshold, window_minutes = excluded.window_minutes,
         quiet_minutes = excluded.quiet_minutes, webhook_url = excluded.webhook_url,
         updated_at = excluded.updated_at`,
    ).bind(
      randomId('alr'),
      chartId,
      projectId,
      v.name,
      v.kind,
      v.threshold,
      v.window,
      v.quiet,
      v.webhook,
      now,
      now,
    ),
    // Webhooks link back to the app; the cron trigger has no request to take the address from.
    env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('app_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).bind(url.origin),
  ]);
  const a = /** @type {AlertRow} */ (await findAlert(env, 'a.chart_id', chartId));
  return json({ alert: alertOut(a, await openIncidentOf(env, a.id)) });
}

/** @param {import('../types.js').RouteContext} c */
export async function deleteChartAlert({ env, ctx, params }) {
  await findChartProject(env, params.id);
  const send = await closeBeforeDelete(env, 'a.chart_id', params.id);
  const res = await env.DB.prepare('DELETE FROM alerts WHERE chart_id = ?').bind(params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'This chart has no alert');
  ctx.waitUntil(send());
  return json({ ok: true });
}

/** @param {URL} url */
function pageOf(url) {
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1) throw new HttpError(400, 'invalid_page', 'page must be 1 or more');
  return page;
}

const OPEN = 'EXISTS (SELECT 1 FROM incidents i WHERE i.alert_id = a.id AND i.resolved_at IS NULL)';

/** @param {Env} env @param {string[]} alertIds */
async function openIncidentsOf(env, alertIds) {
  if (!alertIds.length) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT * FROM incidents WHERE resolved_at IS NULL AND alert_id IN (${alertIds.map(() => '?').join(', ')})`,
  )
    .bind(...alertIds)
    .all();
  return new Map(results.map((i) => [String(i.alert_id), i]));
}

/** @param {import('../types.js').RouteContext} c */
export async function listAlerts({ env, params, url }) {
  const project = await findProject(env, params.id);
  const page = pageOf(url);
  const status = url.searchParams.get('status') ?? 'all';
  if (!['all', 'open', 'ok'].includes(status)) {
    throw new HttpError(400, 'invalid_field', 'status must be all, open or ok');
  }
  const where = `a.project_id = ?${status === 'open' ? ` AND ${OPEN}` : status === 'ok' ? ` AND NOT ${OPEN}` : ''}`;
  const [rows, total, open] = await env.DB.batch([
    env.DB.prepare(`${ALERT_SELECT} WHERE ${where} ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`).bind(
      project.id,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM alerts a WHERE ${where}`).bind(project.id),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM incidents i JOIN alerts a ON a.id = i.alert_id
       WHERE a.project_id = ? AND i.resolved_at IS NULL`,
    ).bind(project.id),
  ]);
  const alerts = /** @type {AlertRow[]} */ (/** @type {unknown} */ (rows.results));
  const opens = await openIncidentsOf(
    env,
    alerts.map((a) => a.id),
  );
  return json({
    alerts: alerts.map((a) => alertOut(a, opens.get(a.id) ?? null)),
    total: total.results[0].n,
    page,
    page_size: PAGE_SIZE,
    open_count: open.results[0].n,
  });
}

/** @param {import('../types.js').RouteContext} c */
export async function getAlert({ env, params, url }) {
  const a = await mustFindAlert(env, params.id);
  const page = pageOf(url);
  const [chart, open, resolved, total] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, dashboard_id, title, filter_json, field, measure, viz, size FROM charts WHERE id = ?',
    ).bind(a.chart_id),
    env.DB.prepare('SELECT * FROM incidents WHERE alert_id = ? AND resolved_at IS NULL').bind(a.id),
    env.DB.prepare(
      'SELECT * FROM incidents WHERE alert_id = ? AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT ? OFFSET ?',
    ).bind(a.id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    env.DB.prepare('SELECT COUNT(*) AS n FROM incidents WHERE alert_id = ? AND resolved_at IS NOT NULL').bind(
      a.id,
    ),
  ]);
  const { filter_json, ...c } = /** @type {Record<string, unknown>} */ (chart.results[0]);
  const openIncident = /** @type {Incident | null} */ (/** @type {unknown} */ (open.results[0] ?? null));
  return json({
    alert: alertOut(a, openIncident),
    chart: { ...c, filter: JSON.parse(String(filter_json)) },
    open_incident: openIncident,
    resolved: { incidents: resolved.results, total: total.results[0].n, page, page_size: PAGE_SIZE },
  });
}

/** Pausing resolves an open incident (and sends its webhook). @param {import('../types.js').RouteContext} c */
export async function pauseAlert({ env, ctx, params }) {
  const a = await mustFindAlert(env, params.id);
  await env.DB.prepare('UPDATE alerts SET paused = 1, updated_at = ? WHERE id = ?')
    .bind(Date.now(), a.id)
    .run();
  const open = await openIncidentOf(env, a.id);
  const resolved = open ? await resolveIncident(env, a, open, 'paused') : null;
  if (resolved) ctx.waitUntil(notify(env, a, resolved, 'incident.resolved'));
  return json({ alert: alertOut(await mustFindAlert(env, a.id)) });
}

/** @param {import('../types.js').RouteContext} c */
export async function resumeAlert({ env, params }) {
  const a = await mustFindAlert(env, params.id);
  await env.DB.prepare('UPDATE alerts SET paused = 0, updated_at = ? WHERE id = ?')
    .bind(Date.now(), a.id)
    .run();
  return json({ alert: alertOut(await mustFindAlert(env, a.id)) });
}

/** Resolving by hand starts the alert's quiet time. @param {import('../types.js').RouteContext} c */
export async function resolveIncidentByHand({ env, ctx, params }) {
  const incident = /** @type {Incident | null} */ (
    await env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(params.id).first()
  );
  if (!incident) throw new HttpError(404, 'not_found', 'Incident not found');
  if (incident.resolved_at) return json({ incident });
  const a = await mustFindAlert(env, incident.alert_id);
  const resolved = await resolveIncident(env, a, incident, 'manual');
  if (resolved) ctx.waitUntil(notify(env, a, resolved, 'incident.resolved'));
  const now = await env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(incident.id).first();
  return json({ incident: now });
}

/** @param {import('../types.js').RouteContext} c */
export async function testWebhook({ request }) {
  const url = parseWebhookUrl(asObject(await readJson(request)).url);
  const result = await postWebhook(url, {
    type: 'test',
    message: 'Test from Open Logs',
    sent_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  return json({ result });
}
