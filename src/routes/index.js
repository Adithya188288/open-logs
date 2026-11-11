// App API (`/api/*`) on Hono. Handlers keep their plain `(RouteContext) => Response` shape;
// `route()` adapts them and enforces sign-in for everything not marked public.
import { Hono } from 'hono';
import { checkOrigin, getSessionUser } from '../auth.js';
import { errorResponse, HttpError, json } from '../http.js';
import { teamName } from '../settings.js';
import * as alerts from './alerts.js';
import * as auth from './auth.js';
import * as boards from './boards.js';
import * as projects from './projects.js';
import * as query from './query.js';
import * as settings from './settings.js';

const API_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

/** @typedef {{ Bindings: Env }} AppEnv */

/** @type {Hono<AppEnv>} */
export const api = new Hono();

api.use('*', async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(API_HEADERS)) c.res.headers.set(k, v);
});

// State-changing requests must come from our own origin, before any routing or auth.
api.use('*', async (c, next) => {
  checkOrigin(c.req.raw, new URL(c.req.url));
  await next();
});

/**
 * @param {'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} method
 * @param {string} path
 * @param {import('../types.js').Handler} handler
 * @param {{ public?: boolean }} [opts]
 */
function route(method, path, handler, opts = {}) {
  api.on(method, path, async (c) => {
    const request = c.req.raw;
    const user = opts.public ? undefined : await getSessionUser(request, c.env, c.executionCtx);
    if (!opts.public && !user) throw new HttpError(401, 'unauthorized', 'Sign in required');
    return handler({
      request,
      env: c.env,
      ctx: c.executionCtx,
      url: new URL(c.req.url),
      params: c.req.param(),
      user: user ?? undefined,
    });
  });
}

route('GET', '/api/health', () => json({ ok: true }), { public: true });
route('GET', '/api/config', async ({ env }) => json({ team_name: await teamName(env) }), { public: true });
route('POST', '/api/auth/login', auth.login, { public: true });
route('POST', '/api/auth/logout', auth.logout);
route('GET', '/api/me', auth.me);
route('POST', '/api/me/password', settings.changePassword);
route('GET', '/api/settings', settings.getSettings);
route('PATCH', '/api/settings', settings.updateSettings);
route('GET', '/api/users', auth.listUsers);
route('DELETE', '/api/users/:id', auth.deleteUser);
route('POST', '/api/invites', auth.createInvite);
route('GET', '/api/invites/:token', auth.getInvite, { public: true });
route('POST', '/api/invites/:token/accept', auth.acceptInvite, { public: true });
route('GET', '/api/projects', projects.listProjects);
route('POST', '/api/projects', projects.createProject);
route('GET', '/api/projects/:id', projects.getProject);
route('PATCH', '/api/projects/:id', projects.renameProject);
route('DELETE', '/api/projects/:id', projects.deleteProject);
route('GET', '/api/projects/:id/sources', projects.listSources);
route('POST', '/api/projects/:id/sources', projects.createSource);
route('GET', '/api/sources/:id', projects.getSource);
route('PATCH', '/api/sources/:id', projects.renameSource);
route('POST', '/api/sources/:id/regenerate', projects.regenerateSource);
route('DELETE', '/api/sources/:id', projects.deleteSource);
route('POST', '/api/query', query.query);
route('POST', '/api/histogram', query.histogram);
route('POST', '/api/aggregate', query.aggregate);
route('GET', '/api/status', query.status);
route('GET', '/api/projects/:id/views', boards.listViews);
route('POST', '/api/projects/:id/views', boards.createView);
route('DELETE', '/api/views/:id', boards.deleteView);
route('GET', '/api/projects/:id/dashboards', boards.listDashboards);
route('POST', '/api/projects/:id/dashboards', boards.createDashboard);
route('GET', '/api/dashboards/:id', boards.getDashboard);
route('PATCH', '/api/dashboards/:id', boards.renameDashboard);
route('DELETE', '/api/dashboards/:id', boards.deleteDashboard);
route('POST', '/api/dashboards/:id/charts', boards.createChart);
route('PATCH', '/api/charts/:id', boards.updateChart);
route('POST', '/api/charts/:id/duplicate', boards.duplicateChart);
route('DELETE', '/api/charts/:id', boards.deleteChart);
route('GET', '/api/charts/:id/alert', alerts.getChartAlert);
route('PUT', '/api/charts/:id/alert', alerts.putChartAlert);
route('DELETE', '/api/charts/:id/alert', alerts.deleteChartAlert);
route('GET', '/api/projects/:id/alerts', alerts.listAlerts);
route('GET', '/api/alerts/:id', alerts.getAlert);
route('POST', '/api/alerts/:id/pause', alerts.pauseAlert);
route('POST', '/api/alerts/:id/resume', alerts.resumeAlert);
route('POST', '/api/incidents/:id/resolve', alerts.resolveIncidentByHand);
route('POST', '/api/webhooks/test', alerts.testWebhook);

/**
 * Unknown /api paths: don't reveal which endpoints exist to signed-out callers.
 * Registered on the top-level app, since Hono doesn't carry a sub-app's notFound through `route()`.
 * @param {import('hono').Context<{ Bindings: Env }>} c
 */
export async function apiNotFound(c) {
  const user = await getSessionUser(c.req.raw, c.env, c.executionCtx);
  return errorResponse(
    user
      ? new HttpError(404, 'not_found', 'No such endpoint')
      : new HttpError(401, 'unauthorized', 'Sign in required'),
  );
}

api.onError((err) => {
  if (!(err instanceof HttpError)) console.error('api error', err instanceof Error ? err.message : err);
  const res = errorResponse(
    err instanceof HttpError ? err : new HttpError(500, 'internal', 'Something went wrong'),
  );
  for (const [k, v] of Object.entries(API_HEADERS)) res.headers.set(k, v);
  return res;
});
