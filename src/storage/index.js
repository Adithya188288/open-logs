// LogStorage: where log events live. Logs always live in Cloudflare Basin; D1 holds only app data.
import { BasinStorage } from './basin.js';

/**
 * A stored event. `source_id` never changes; `source` is the source's name when the event arrived.
 * `fields` is a JSON object string.
 * @typedef {{ id: string, ts: number, project_id: string, source_id: string, source: string, level: string, message: string, fields: string }} StoredEvent
 * @typedef {{ id: string, ts: number, source_id: string, source: string, level: string, message: string, fields: Record<string, unknown> }} EventOut
 * @typedef {{ t: number, debug: number, info: number, warn: number, error: number, fatal: number }} Bucket
 * @typedef {{ measure: 'count' | 'count_over_time' | 'avg' | 'p95', field?: string, group_by?: string, interval: number, parts?: string[] }} AggregateSpec
 * @typedef {{ t: number, value: number }} Point
 * @typedef {{ value: number | null, groups: { key: string, value: number }[], series: Point[], series_by_group: { key: string, series: Point[] }[], interval_ms: number }} AggregateResult
 *
 * @typedef {object} LogStorage
 * @property {'basin'} mode
 * @property {number} lagMs  typical delay between ingest and queryability
 * @property {(events: StoredEvent[]) => Promise<void>} write
 * @property {(filter: import('../query/filter.js').Filter) => Promise<{ events: EventOut[], next_cursor: string | null }>} query
 * @property {(filter: import('../query/filter.js').Filter, interval: number) => Promise<{ interval_ms: number, buckets: Bucket[] }>} histogram
 * @property {(filter: import('../query/filter.js').Filter, spec: AggregateSpec) => Promise<AggregateResult>} aggregate
 * @property {(projectId: string, lookbackMs?: number) => Promise<number | null>} newest
 * @property {(projectId: string) => Promise<void>} deleteProject
 */

/**
 * @param {Env} env
 * @returns {LogStorage}
 */
export function getStorage(env) {
  return new BasinStorage(env);
}
