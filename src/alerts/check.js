// The once-a-minute alert check (cron trigger). For each alert that isn't paused: claim it for this minute's period,
// ask Basin for its chart's value over the alert's period, then open or resolve its incident. With no alerts it
// does nothing. There is no global lock: a slow run can overlap the next one, and the per-alert claim keeps an
// older run from acting on an alert a newer run has already taken.
import { sourceNames } from '../query/sources.js';
import {
  ALERT_SELECT,
  chartValue,
  holds,
  MINUTE,
  notify,
  openIncident,
  openIncidentOf,
  resolveIncident,
  SETTLE_MS,
} from './alerts.js';

// Few Basin queries at a time: Basin answers less reliably when many run at once.
const AT_ONCE = 4;
// A run stops starting new alerts after this long; the ones left go first in the next minute's run. Runs may
// still overlap when Basin is slow, which is safe: each alert is claimed per period (below).
const BUDGET_MS = 45_000;

/**
 * Claims an alert for this check's period: only one check per period gets it, and a newer period takes it over
 * from an older one. The claim is what openIncident / resolveIncident check before they change anything.
 * @param {Env} env @param {string} alertId @param {number} end
 */
async function claim(env, alertId, end) {
  const res = await env.DB.prepare(
    'UPDATE alerts SET checked_until = ? WHERE id = ? AND paused = 0 AND checked_until < ?',
  )
    .bind(end, alertId, end)
    .run();
  return res.meta.changes > 0;
}

/**
 * @param {Env} env
 * @param {number} scheduledTime  the cron's scheduled time
 */
export async function checkAlerts(env, scheduledTime) {
  const started = Date.now();
  const end = Math.floor(scheduledTime / MINUTE) * MINUTE - SETTLE_MS;
  // Least recently checked first, so alerts a slow run didn't reach go first next time.
  const { results } = await env.DB.prepare(
    `${ALERT_SELECT} WHERE a.paused = 0 AND a.checked_until < ? ORDER BY a.checked_until, a.id`,
  )
    .bind(end)
    .all();
  const alerts = /** @type {import('./alerts.js').AlertRow[]} */ (/** @type {unknown} */ (results));
  /** @type {Map<string, Promise<Map<string, string>>>} */
  const names = new Map();
  const namesOf = (/** @type {string} */ projectId) => {
    if (!names.has(projectId)) names.set(projectId, sourceNames(env, projectId));
    return /** @type {Promise<Map<string, string>>} */ (names.get(projectId));
  };
  for (let i = 0; i < alerts.length && Date.now() - started < BUDGET_MS; i += AT_ONCE) {
    await Promise.all(
      alerts.slice(i, i + AT_ONCE).map(async (a) => {
        try {
          if (await claim(env, a.id, end)) await checkOne(env, a, end, namesOf);
        } catch (err) {
          console.error('alert check failed', a.id, err instanceof Error ? err.message : err);
        }
      }),
    );
  }
}

/**
 * @param {Env} env
 * @param {import('./alerts.js').AlertRow} a
 * @param {number} end
 * @param {(projectId: string) => Promise<Map<string, string>>} namesOf
 */
async function checkOne(env, a, end, namesOf) {
  const names = await namesOf(a.project_id);
  const span = a.window_minutes * MINUTE;
  const value = await chartValue(env, names, a, end - span, end);
  if (value === null) {
    // No logs to measure (an average or p95): resolve an open incident once that has lasted no_data_minutes.
    const open = await openIncidentOf(env, a.id);
    if (open && Date.now() - open.last_data_at >= a.no_data_minutes * MINUTE) {
      const resolved = await resolveIncident(env, a, open, 'no_data', end);
      if (resolved) await notify(env, a, resolved, 'incident.resolved');
    }
    return;
  }
  const previous = a.kind === 'increase' ? await chartValue(env, names, a, end - 2 * span, end - span) : null;
  const firing = holds(a, value, previous);
  const open = await openIncidentOf(env, a.id);
  if (open && firing) {
    await env.DB.prepare('UPDATE incidents SET last_data_at = ? WHERE id = ?')
      .bind(Date.now(), open.id)
      .run();
  } else if (open && !firing) {
    const resolved = await resolveIncident(env, a, open, 'auto', end);
    if (resolved) await notify(env, a, resolved, 'incident.resolved');
  } else if (!open && firing && Date.now() >= a.quiet_until) {
    const incident = await openIncident(env, a, value, previous, end);
    if (incident) await notify(env, a, incident, 'incident.opened');
  }
}
