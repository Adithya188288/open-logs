// Open Logs Worker: ingest at /v1/logs, app API at /api/* (Hono), and the React app for everything else.
import { Hono } from 'hono';
import { handleIngest } from './ingest/handler.js';
import { api } from './routes/index.js';

/** @type {Hono<{ Bindings: Env }>} */
const app = new Hono();

app.all('/v1/logs', (c) => handleIngest(c.req.raw, c.env, c.executionCtx));
app.route('/', api);

export default app;
