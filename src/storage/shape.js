// Turns raw SQL rows into API shapes. Shared by both adapters.
import { encodeCursor } from '../query/filter.js';

const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];

/** @param {unknown} raw */
function parseFields(raw) {
  if (raw && typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw);
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>[]} rows  limit + 1 rows, newest first
 * @param {number} limit
 */
export function eventsPage(rows, limit) {
  const page = rows.slice(0, limit).map((r) => ({
    id: String(r.id),
    ts: Number(r.ts),
    source: String(r.source),
    level: String(r.level),
    message: String(r.message),
    fields: parseFields(r.fields),
  }));
  const last = page.at(-1);
  return { events: page, next_cursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/**
 * Dense buckets from `from` to `to`, with zero counts where there were no events.
 * @param {Record<string, unknown>[]} rows  { t, level, n }
 * @param {number} from
 * @param {number} to
 * @param {number} interval
 */
export function histogramBuckets(rows, from, to, interval) {
  /** @type {Map<number, import('./index.js').Bucket>} */
  const map = new Map();
  for (let t = Math.floor(from / interval) * interval; t < to; t += interval) {
    map.set(t, { t, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
  }
  for (const r of rows) {
    const b = map.get(Number(r.t));
    const level = String(r.level);
    if (b && LEVELS.includes(level)) b[/** @type {'info'} */ (level)] += Number(r.n);
  }
  return { interval_ms: interval, buckets: [...map.values()] };
}

/**
 * @param {Record<string, unknown>[]} rows  { t, v }
 * @param {number} from
 * @param {number} to
 * @param {number} interval
 * @param {boolean} zeroFill  counts default to 0; averages leave gaps out
 */
export function seriesPoints(rows, from, to, interval, zeroFill) {
  const byT = new Map(rows.map((r) => [Number(r.k), Number(r.v)]));
  const out = [];
  for (let t = Math.floor(from / interval) * interval; t < to; t += interval) {
    if (byT.has(t)) out.push({ t, value: /** @type {number} */ (byT.get(t)) });
    else if (zeroFill) out.push({ t, value: 0 });
  }
  return out;
}

/**
 * @param {Record<string, unknown>[]} rows  { project_id, t, n, e }
 * @param {string[]} projectIds
 * @param {number} from
 * @param {number} to
 * @param {number} interval
 */
export function overviewShape(rows, projectIds, from, to, interval) {
  const start = Math.floor(from / interval) * interval;
  const count = Math.ceil((to - start) / interval);
  /** @type {Record<string, { total: number, errors: number, series: number[] }>} */
  const out = {};
  for (const id of projectIds) out[id] = { total: 0, errors: 0, series: new Array(count).fill(0) };
  for (const r of rows) {
    const o = out[String(r.project_id)];
    if (!o) continue;
    const i = Math.floor((Number(r.t) - start) / interval);
    o.total += Number(r.n);
    o.errors += Number(r.e);
    if (i >= 0 && i < count) o.series[i] += Number(r.n);
  }
  return out;
}
