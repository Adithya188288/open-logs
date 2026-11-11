// Runs a chart aggregate through Basin SQL, computing only the requested parts.
import { buildAggregateSql } from '../query/sql.js';
import { aggregateShape } from './shape.js';

export const AGGREGATE_PARTS = ['value', 'groups', 'series', 'series_by_group'];

/**
 * @param {(q: { sql: string }) => Promise<Record<string, unknown>[]>} all
 * @param {import('../query/sql.js').Dialect} dialect
 * @param {import('../query/filter.js').Filter} filter
 * @param {import('./index.js').AggregateSpec} spec
 */
export async function runAggregate(all, dialect, filter, spec) {
  const want = new Set(spec.parts ?? AGGREGATE_PARTS);
  const q = buildAggregateSql(filter, spec, dialect);
  const needGroups = q.groups && (want.has('groups') || want.has('series_by_group'));
  const [value, groups, series] = await Promise.all([
    want.has('value') ? all(q.value) : null,
    needGroups && q.groups ? all(q.groups) : [],
    want.has('series') ? all(q.series) : [],
  ]);
  const top = groups.filter((g) => g.k !== null).map((g) => ({ key: String(g.k), value: Number(g.v) }));
  const gq = want.has('series_by_group') ? q.groupSeries(top.slice(0, 5).map((g) => g.key)) : null;
  const shaped = aggregateShape(spec, filter, value ?? [], top, series, gq ? await all(gq) : []);
  return {
    ...shaped,
    value: value ? shaped.value : null,
    groups: want.has('groups') ? shaped.groups : [],
    series: want.has('series') ? shaped.series : [],
    series_by_group: gq ? shaped.series_by_group : [],
  };
}
