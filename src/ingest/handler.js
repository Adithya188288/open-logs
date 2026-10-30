// POST /v1/logs: bearer source token → validated, normalised events → LogStorage.
import { clientIp, rateLimit } from '../auth.js';
import { sha256Hex } from '../crypto.js';
import { errorResponse, HttpError, json, readText } from '../http.js';
import { getStorage } from '../storage/index.js';
import { normalizeEvent } from './normalize.js';

export const MAX_BATCH_BYTES = 5 * 1024 * 1024; // Basin Pipelines accepts up to 5 MB per request.
export const MAX_EVENT_BYTES = 256 * 1024;
export const MAX_EVENTS = 10_000;
const TOKEN_RE = /^ol_[A-Za-z0-9_-]{43}$/;
const LAST_EVENT_WRITE_MS = 5_000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

/**
 * @param {Request} request
 * @param {Env} env
 * @param {ExecutionContext} ctx
 */
export async function handleIngest(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  let res;
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
    res = await ingest(request, env, ctx);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('ingest error', err instanceof Error ? err.message : err);
    res = errorResponse(err instanceof HttpError ? err : new HttpError(500, 'internal', 'Ingest failed'));
  }
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {ExecutionContext} ctx
 */
async function ingest(request, env, ctx) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!TOKEN_RE.test(token)) throw new HttpError(401, 'invalid_token', 'Missing or invalid token');

  const source = await env.DB.prepare('SELECT id, project_id, name FROM sources WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first();
  if (!source) {
    await rateLimit(env.INGEST_LIMITER, `bad:${clientIp(request)}`);
    ctx.waitUntil(recordRejection(env, token.slice(0, 8)));
    throw new HttpError(401, 'invalid_token', 'Missing or invalid token');
  }
  await rateLimit(env.INGEST_LIMITER, String(source.id));

  const text = await readText(request, MAX_BATCH_BYTES);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body must be a JSON object or array of objects');
  }
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0) throw new HttpError(400, 'empty_batch', 'Send at least one event');
  if (items.length > MAX_EVENTS)
    throw new HttpError(413, 'too_many_events', `Send at most ${MAX_EVENTS} events per request`);

  const now = Date.now();
  const src = { project_id: String(source.project_id), name: String(source.name) };
  const events = items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, 'invalid_event', 'Each event must be a JSON object', { index });
    }
    const event = normalizeEvent(item, src, now);
    if (event.message.length + event.fields.length > MAX_EVENT_BYTES) {
      throw new HttpError(413, 'event_too_large', `Each event must be under ${MAX_EVENT_BYTES} bytes`, {
        index,
      });
    }
    return event;
  });

  await getStorage(env).write(events);
  ctx.waitUntil(
    env.DB.prepare(
      'UPDATE sources SET last_event_at = ? WHERE id = ? AND (last_event_at IS NULL OR last_event_at < ?)',
    )
      .bind(now, source.id, now - LAST_EVENT_WRITE_MS)
      .run(),
  );
  return json({ accepted: events.length }, 202);
}

/**
 * Counts a rejected request against the source whose current or previous token has this prefix,
 * so the UI can say "requests from worker are being rejected".
 * @param {Env} env
 * @param {string} prefix
 */
async function recordRejection(env, prefix) {
  await env.DB.prepare(
    `UPDATE sources SET rejected_count = rejected_count + 1, last_rejected_at = ?
     WHERE token_prefix = ? OR prev_token_prefix = ?`,
  )
    .bind(Date.now(), prefix, prefix)
    .run();
}
