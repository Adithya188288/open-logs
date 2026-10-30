// Log search, histogram, chart aggregates and freshness status.
import { HttpError, json, readJson } from '../http.js';
import { parseFilter } from '../query/filter.js';
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
