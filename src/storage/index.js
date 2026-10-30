// LogStorage: where log events live. `LOG_STORAGE=local|basin` picks the adapter.
import { BasinStorage } from './basin.js';
import { LocalStorage } from './local.js';

/**
 * A stored event (both adapters). `fields` is a JSON object string.
 * @typedef {{ id: string, ts: number, project_id: string, source: string, level: string, message: string, fields: string }} StoredEvent
 * @typedef {{ id: string, ts: number, source: string, level: string, message: string, fields: Record<string, unknown> }} EventOut
 * @typedef {{ t: number, debug: number, info: number, warn: number, error: number, fatal: number }} Bucket
 * @typedef {{ measure: 'count' | 'count_over_time' | 'avg' | 'p95', field?: string, group_by?: string, interval: number, parts?: string[] }} AggregateSpec
 * @typedef {{ t: number, value: number }} Point
 * @typedef {{ value: number | null, groups: { key: string, value: number }[], series: Point[], series_by_group: { key: string, series: Point[] }[], interval_ms: number }} AggregateResult
 *
 * @typedef {object} LogStorage
 * @property {'local' | 'basin'} mode
 * @property {number} lagMs  typical delay between ingest and queryability
 * @property {(events: StoredEvent[]) => Promise<void>} write
 * @property {(filter: import('../query/filter.js').Filter) => Promise<{ events: EventOut[], next_cursor: string | null }>} query
 * @property {(filter: import('../query/filter.js').Filter, interval: number) => Promise<{ interval_ms: number, buckets: Bucket[] }>} histogram
 * @property {(filter: import('../query/filter.js').Filter, spec: AggregateSpec) => Promise<AggregateResult>} aggregate
 * @property {(projectId: string) => Promise<number | null>} newest
 * @property {(projectIds: string[], from: number, to: number, interval: number) => Promise<Record<string, { total: number, errors: number, series: number[] }>>} overview
 * @property {(projectId: string) => Promise<void>} deleteProject
 */

/**
 * @param {Env} env
 * @returns {LogStorage}
 */
export function getStorage(env) {
  if (env.LOG_STORAGE === 'basin') return new BasinStorage(env);
  return new LocalStorage(env.DB);
}
