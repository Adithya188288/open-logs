// Live data (dashboard charts and live tail) shared by the screens and the start-up preload,
// so both make the same requests under the same cache keys.
import { queryOptions } from '@tanstack/react-query';
import { api } from './api.js';

export const RANGES = { '15m': 15 * 60_000, '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };
export const DEFAULT_DASHBOARD_RANGE = '1h';
export const TAIL_PAGE = 100;

/** @typedef {keyof typeof RANGES} Range */
/** @typedef {import('../components/Charts.jsx').ChartDef & { id: string, size: string, alert?: { id: string, paused: boolean, open: boolean } | null }} ChartRow */

/** @param {Range} range */
export function windowFor(range) {
  const to = Date.now() + 1000;
  return { from: to - RANGES[range], to };
}

/**
 * Which parts of an aggregate a chart draws. Each part is a Basin query (min 10 MB billed),
 * so asking only for these keeps a dashboard load cheap.
 * @param {Pick<ChartRow, 'field' | 'measure' | 'viz'>} c
 */
export function partsFor(c) {
  const grouped = Boolean(c.field) || c.measure === 'avg' || c.measure === 'p95';
  if (c.viz === 'number') return ['value', 'series'];
  if (c.viz === 'pie') return ['value', 'groups'];
  if (c.viz === 'line') return grouped && c.measure !== 'count' ? ['series', 'series_by_group'] : ['series'];
  if (c.measure === 'count_over_time') return c.field ? ['series', 'series_by_group'] : ['series'];
  return grouped ? ['groups'] : ['series'];
}

/**
 * @param {string} projectId
 * @param {Pick<ChartRow, 'filter' | 'field' | 'measure' | 'viz'>} c
 * @param {{ from: number, to: number }} w
 * @param {string[]} [parts]
 */
export function aggregate(projectId, c, w, parts = partsFor(c)) {
  return api('/api/aggregate', {
    body: {
      project_id: projectId,
      ...w,
      where: c.filter.where,
      measure: c.measure,
      field: c.field ?? undefined,
      parts,
    },
  });
}

/**
 * One chart's data for a range (number charts also get the previous period, for the trend).
 * Keyed by what the chart shows, so an edited chart re-queries and an unchanged one stays cached.
 * @param {string} projectId
 * @param {ChartRow} c
 * @param {Range} range
 */
export function chartQuery(projectId, c, range) {
  return queryOptions({
    queryKey: ['agg', projectId, c.id, JSON.stringify([c.filter, c.field, c.measure, c.viz]), range],
    queryFn: async () => {
      const w = windowFor(range);
      const span = w.to - w.from;
      const [data, prev] = await Promise.all([
        aggregate(projectId, c, w),
        c.viz === 'number' ? aggregate(projectId, c, { from: w.from - span, to: w.from }, ['value']) : null,
      ]);
      return { data, prev };
    },
  });
}

/**
 * Cache key for one live tail view. The default view (all sources, no search, 15 min) is what
 * the start-up preload fills.
 * @param {string} projectId
 * @param {{ where?: object[], zoom?: object | null, range?: string, custom?: object, reloadKey?: number }} [view]
 */
export function tailKey(projectId, view = {}) {
  const { where = [], zoom = null, range = '15m', custom = { from: 0, to: 0 }, reloadKey = 0 } = view;
  return ['tail', JSON.stringify([projectId, where, zoom, range, custom, reloadKey])];
}

/**
 * Latest rows, histogram and freshness for a live tail view.
 * @param {string} projectId
 * @param {object[]} where
 * @param {{ from: number, to: number }} w
 * @param {boolean} filtered  when nothing matches, also count unfiltered events for the empty state
 */
export async function fetchTail(projectId, where, w, filtered) {
  const body = { project_id: projectId, ...w, where };
  const [page, hist, status] = await Promise.all([
    api('/api/query', { body: { ...body, limit: TAIL_PAGE } }),
    api('/api/histogram', { body }),
    api(`/api/status?project_id=${encodeURIComponent(projectId)}`),
  ]);
  const unfiltered =
    !page.events.length && filtered
      ? (await api('/api/histogram', { body: { project_id: projectId, ...w } })).total
      : 0;
  return { events: page.events, nextCursor: page.next_cursor, hist, status, unfiltered, at: Date.now() };
}
