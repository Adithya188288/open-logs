// Open Logs Worker: ingest at /v1/logs, app API at /api/* (Hono), the React app for everything else,
// and the once-a-minute alert check (cron trigger).
import { Hono } from 'hono';
import { checkAlerts } from './alerts/check.js';
import { handleIngest } from './ingest/handler.js';
import { api, apiNotFound } from './routes/index.js';

/** @type {Hono<{ Bindings: Env }>} */
const app = new Hono();

app.all('/v1/logs', (c) => handleIngest(c.req.raw, c.env, c.executionCtx));
app.route('/', api);
app.notFound(apiNotFound);

export default {
  fetch: app.fetch,
  /** @param {ScheduledController} controller @param {Env} env @param {ExecutionContext} ctx */
  scheduled(controller, env, ctx) {
    ctx.waitUntil(checkAlerts(env, controller.scheduledTime));
  },
};
