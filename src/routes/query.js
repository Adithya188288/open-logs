// Log search, histogram, chart aggregates and freshness status.
import { HttpError, json, readJson } from '../http.js';
import { parseField, parseFilter, pickInterval } from '../query/filter.js';
import { bySourceId, nameOf, sourceNames } from '../query/sources.js';
import { AGGREGATE_PARTS } from '../storage/aggregate.js';
import { NEWEST_RECENT_MS } from '../storage/basin.js';
import { getStorage } from '../storage/index.js';
import { findProject } from './projects.js';

/**
 * Parses the body as a filter, checks the project exists, and turns source names into source ids.
 * @param {Request} request
 * @param {Env} env
 */
export async function readFilter(request, env) {
  const body = await readJson(request);
  const parsed = parseFilter(body);
  await findProject(env, parsed.project_id);
  const names = await sourceNames(env, parsed.project_id);
  return { filter: bySourceId(parsed, names), names, body: /** @type {Record<string, unknown>} */ (body) };
}

/** Group by the source's id rather than its name. @param {string | undefined} field */
const groupable = (field) => (field === 'source' ? 'source_id' : field);

/**
 * Runs a storage call, mapping engine timeouts to the "query too large" state.
 * @template T
 * @param {() => Promise<T>} fn
 */
export async function runQuery(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (/timeout|too (large|complex|much)|exceeded|scan/i.test(String(err))) {
      throw new HttpError(422, 'query_too_large', 'This search would scan too much data', {
        hint: 'Narrow the time range or add a field filter like level:error.',
      });
    }
    throw err;
  }
}

/** @param {import('../types.js').RouteContext} c */
export async function query({ request, env }) {
  const { filter, names } = await readFilter(request, env);
  const page = await runQuery(() => getStorage(env).query(filter));
  const events = page.events.map((e) => ({ ...e, source: nameOf(names, e.source_id, e.source) }));
  return json({ ...page, events });
}

const MEASURES = new Set(['count', 'count_over_time', 'avg', 'p95']);

/** @param {import('../types.js').RouteContext} c */
export async function histogram({ request, env }) {
  const { filter } = await readFilter(request, env);
  const interval = pickInterval(filter.from, filter.to);
  const h = await runQuery(() => getStorage(env).histogram(filter, interval));
  let total = 0;
  let errors = 0;
  for (const b of h.buckets) {
    total += b.debug + b.info + b.warn + b.error + b.fatal;
    errors += b.error + b.fatal;
  }
  return json({ ...h, total, errors });
}

/** @param {import('../types.js').RouteContext} c */
export async function aggregate({ request, env }) {
  const { filter, names, body } = await readFilter(request, env);
  const measure = String(body.measure);
  if (!MEASURES.has(measure))
    throw new HttpError(400, 'invalid_field', 'measure must be count, count_over_time, avg or p95');
  const field = body.field ? parseField(body.field) : undefined;
  if ((measure === 'avg' || measure === 'p95') && !field?.startsWith('fields.')) {
    throw new HttpError(400, 'invalid_field', `${measure} needs a numeric fields.* field`);
  }
  const group_by = body.group_by ? parseField(body.group_by) : undefined;
  const parts = body.parts === undefined ? undefined : body.parts;
  if (parts !== undefined && (!Array.isArray(parts) || !parts.every((p) => AGGREGATE_PARTS.includes(p)))) {
    throw new HttpError(400, 'invalid_field', `parts must be a list of: ${AGGREGATE_PARTS.join(', ')}`);
  }
  const spec = {
    measure: /** @type {'count'} */ (measure),
    field: measure === 'count' || measure === 'count_over_time' ? groupable(field) : field,
    group_by: groupable(group_by),
    interval: pickInterval(filter.from, filter.to, 30),
    parts,
  };
  const result = await runQuery(() => getStorage(env).aggregate(filter, spec));
  // Same rule as the SQL builder: counts group by `field`; avg / p95 group by `group_by`, else by source.
  const counting = spec.measure === 'count' || spec.measure === 'count_over_time';
  const groupedBy = counting ? spec.field : (spec.group_by ?? 'source_id');
  if (groupedBy !== 'source_id') return json(result);
  const label = (/** @type {string} */ key) => nameOf(names, key, 'deleted source');
  return json({
    ...result,
    groups: result.groups.map((g) => ({ ...g, key: label(g.key) })),
    series_by_group: result.series_by_group.map((g) => ({ ...g, key: label(g.key) })),
  });
}

/** @param {import('../types.js').RouteContext} c */
export async function status({ env, url }) {
  const storage = getStorage(env);
  const projectId = url.searchParams.get('project_id');
  // `recent=1` (the dashboard's 30 s check for new arrivals) only looks at the last 15 minutes.
  const lookback = url.searchParams.get('recent') === '1' ? NEWEST_RECENT_MS : undefined;
  const newest = projectId ? await storage.newest((await findProject(env, projectId)).id, lookback) : null;
  return json({ storage: storage.mode, lag_ms: storage.lagMs, now: Date.now(), newest_event_at: newest });
}
