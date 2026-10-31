// Turns raw Basin SQL rows into API shapes.
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
    source_id: String(r.source_id),
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
  const byT = new Map(rows.map((r) => [Number(r.t), Number(r.v)]));
  const out = [];
  for (let t = Math.floor(from / interval) * interval; t < to; t += interval) {
    if (byT.has(t)) out.push({ t, value: /** @type {number} */ (byT.get(t)) });
    else if (zeroFill) out.push({ t, value: 0 });
  }
  return out;
}

/**
 * @param {import('./index.js').AggregateSpec} spec
 * @param {import('../query/filter.js').Filter} filter
 * @param {Record<string, unknown>[]} valueRows  { v }
 * @param {{ key: string, value: number }[]} groups
 * @param {Record<string, unknown>[]} seriesRows  { t, v }
 * @param {Record<string, unknown>[]} groupRows  { k, t, v }
 * @returns {import('./index.js').AggregateResult}
 */
export function aggregateShape(spec, filter, valueRows, groups, seriesRows, groupRows) {
  const counting = spec.measure === 'count' || spec.measure === 'count_over_time';
  const v = valueRows[0]?.v;
  const byKey = Map.groupBy(groupRows, (r) => String(r.k));
  return {
    value: v === null || v === undefined ? (counting ? 0 : null) : Number(v),
    groups,
    series: seriesPoints(seriesRows, filter.from, filter.to, spec.interval, counting),
    series_by_group: groups.slice(0, 5).map((g) => ({
      key: g.key,
      series: seriesPoints(byKey.get(g.key) ?? [], filter.from, filter.to, spec.interval, counting),
    })),
    interval_ms: spec.interval,
  };
}
