// The once-a-minute alert check (cron trigger). For each alert that isn't paused: ask Basin for its chart's value
// over the alert's period, then open or resolve its incident. With no alerts it does nothing.
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

// A check normally takes seconds; the lock makes sure two never overlap if one runs long.
const LOCK_MS = 55_000;
// Few Basin queries at a time: Basin answers less reliably when many run at once.
const AT_ONCE = 4;

/** @param {Env} env @param {number} until */
async function takeLock(env, until) {
  const res = await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('alert_check_lock', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(settings.value AS INTEGER) < ?`,
  )
    .bind(String(until), Date.now())
    .run();
  return res.meta.changes > 0;
}

/** @param {Env} env @param {number} until */
function releaseLock(env, until) {
  return env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'alert_check_lock' AND value = ?")
    .bind(String(until))
    .run();
}

/**
 * @param {Env} env
 * @param {number} scheduledTime  the cron's scheduled time
 */
export async function checkAlerts(env, scheduledTime) {
  const { results } = await env.DB.prepare(`${ALERT_SELECT} WHERE a.paused = 0`).all();
  const alerts = /** @type {import('./alerts.js').AlertRow[]} */ (/** @type {unknown} */ (results));
  if (!alerts.length) return;
  const until = Date.now() + LOCK_MS;
  if (!(await takeLock(env, until))) return;
  try {
    const end = Math.floor(scheduledTime / MINUTE) * MINUTE - SETTLE_MS;
    /** @type {Map<string, Promise<Map<string, string>>>} */
    const names = new Map();
    const namesOf = (/** @type {string} */ projectId) => {
      if (!names.has(projectId)) names.set(projectId, sourceNames(env, projectId));
      return /** @type {Promise<Map<string, string>>} */ (names.get(projectId));
    };
    for (let i = 0; i < alerts.length; i += AT_ONCE) {
      await Promise.all(
        alerts
          .slice(i, i + AT_ONCE)
          .map((a) =>
            checkOne(env, a, end, namesOf).catch((err) =>
              console.error('alert check failed', a.id, err instanceof Error ? err.message : err),
            ),
          ),
      );
    }
  } finally {
    await releaseLock(env, until);
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
  if (value === null) return;
  const previous = a.kind === 'increase' ? await chartValue(env, names, a, end - 2 * span, end - span) : null;
  const firing = holds(a, value, previous);
  const open = await openIncidentOf(env, a.id);
  if (open && !firing) {
    const resolved = await resolveIncident(env, a, open, 'auto');
    if (resolved) await notify(env, a, resolved, 'incident.resolved');
  } else if (!open && firing && Date.now() >= a.quiet_until) {
    const incident = await openIncident(env, a, value, previous);
    if (incident) await notify(env, a, incident, 'incident.opened');
  }
}
