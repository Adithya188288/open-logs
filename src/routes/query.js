// Log search, histogram, chart aggregates and freshness status.
import { HttpError, json, readJson } from '../http.js';
import { parseField, parseFilter, pickInterval } from '../query/filter.js';
import { getStorage } from '../storage/index.js';
import { findProject } from './projects.js';

/**
 * Parses the body as a filter and checks the project exists.
 * @param {Request} request
 * @param {Env} env
 */
export async function readFilter(request, env) {
  const body = await readJson(request);
  const filter = parseFilter(body);
  await findProject(env, filter.project_id);
  return { filter, body: /** @type {Record<string, unknown>} */ (body) };
}

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
    if (/timeout|too (large|complex)|exceeded/i.test(String(err))) {
      throw new HttpError(422, 'query_too_large', 'This search would scan too much data', {
        hint: 'Narrow the time range or add a field filter like level:error.',
      });
    }
    throw err;
  }
}

/** @param {import('../router.js').RouteContext} c */
export async function query({ request, env }) {
  const { filter } = await readFilter(request, env);
  return json(await runQuery(() => getStorage(env).query(filter)));
}

const MEASURES = new Set(['count', 'count_over_time', 'avg', 'p95']);

/** @param {import('../router.js').RouteContext} c */
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

/** @param {import('../router.js').RouteContext} c */
export async function aggregate({ request, env }) {
  const { filter, body } = await readFilter(request, env);
  const measure = String(body.measure);
  if (!MEASURES.has(measure))
    throw new HttpError(400, 'invalid_field', 'measure must be count, count_over_time, avg or p95');
  const field = body.field ? parseField(body.field) : undefined;
  if ((measure === 'avg' || measure === 'p95') && !field?.startsWith('fields.')) {
    throw new HttpError(400, 'invalid_field', `${measure} needs a numeric fields.* field`);
  }
  const group_by = body.group_by ? parseField(body.group_by) : undefined;
  const spec = {
    measure: /** @type {'count'} */ (measure),
    field,
    group_by,
    interval: pickInterval(filter.from, filter.to, 30),
  };
  return json(await runQuery(() => getStorage(env).aggregate(filter, spec)));
}

/** @param {import('../router.js').RouteContext} c */
export async function status({ env, url }) {
  const storage = getStorage(env);
  const projectId = url.searchParams.get('project_id');
  const newest = projectId ? await storage.newest((await findProject(env, projectId)).id) : null;
  return json({ storage: storage.mode, lag_ms: storage.lagMs, now: Date.now(), newest_event_at: newest });
}
