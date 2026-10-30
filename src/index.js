// Open Logs Worker: ingest at /v1/logs, app API at /api/*, static UI for everything else.
import { checkOrigin, getSessionUser } from './auth.js';
import { errorResponse, HttpError, json } from './http.js';
import { handleIngest } from './ingest/handler.js';
import { api, PUBLIC_ROUTES } from './routes/index.js';

const API_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/v1/logs') return handleIngest(request, env, ctx);
    if (url.pathname.startsWith('/api/')) return withHeaders(await handleApi(request, env, ctx, url));
    return env.ASSETS.fetch(request);
  },
};

/**
 * @param {Request} request
 * @param {Env} env
 * @param {ExecutionContext} ctx
 * @param {URL} url
 */
async function handleApi(request, env, ctx, url) {
  try {
    checkOrigin(request, url);
    const found = api.match(request.method, url.pathname);
    const pattern = found && 'handler' in found ? found.key : '';
    const user = PUBLIC_ROUTES.has(pattern) ? undefined : await getSessionUser(request, env, ctx);
    if (!PUBLIC_ROUTES.has(pattern) && !user) throw new HttpError(401, 'unauthorized', 'Sign in required');
    if (!found) throw new HttpError(404, 'not_found', 'No such endpoint');
    if ('allowed' in found) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
    return await found.handler({ request, env, ctx, url, params: found.params, user: user ?? undefined });
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    console.error('api error', err instanceof Error ? err.message : err);
    return errorResponse(new HttpError(500, 'internal', 'Something went wrong'));
  }
}

/** @param {Response} res */
function withHeaders(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_HEADERS)) out.headers.set(k, v);
  return out;
}
