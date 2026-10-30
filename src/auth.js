// Cookie sessions, role checks and sign-in rate limiting.
import { newSecret, sha256Hex } from './crypto.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'ol_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_WRITE_INTERVAL_MS = 60 * 1000;
const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

/**
 * @typedef {{ id: string, email: string, name: string, role: 'owner' | 'admin' | 'member', created_at: number, last_active_at: number | null }} SessionUser
 */

/**
 * Creates a session row and returns the Set-Cookie header value.
 * @param {Env} env
 * @param {string} userId
 */
export async function createSession(env, userId) {
  const token = newSecret('');
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now + SESSION_TTL_MS, now)
    .run();
  return cookie(token, SESSION_TTL_MS / 1000);
}

/**
 * @param {string} value
 * @param {number} maxAgeSeconds
 */
function cookie(value, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedCookie() {
  return cookie('', 0);
}

/** @param {Request} request */
function readSessionToken(request) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return '';
}

/**
 * Resolves the signed-in user, or null.
 * @param {Request} request
 * @param {Env} env
 * @param {ExecutionContext} [ctx]
 * @returns {Promise<SessionUser | null>}
 */
export async function getSessionUser(request, env, ctx) {
  const token = readSessionToken(request);
  if (!token || token.length > 128) return null;
  const now = Date.now();
  const user = /** @type {SessionUser | null} */ (
    await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_active_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
      .bind(await sha256Hex(token), now)
      .first()
  );
  if (user && (user.last_active_at ?? 0) < now - ACTIVE_WRITE_INTERVAL_MS) {
    const write = env.DB.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').bind(now, user.id).run();
    ctx ? ctx.waitUntil(write) : await write;
  }
  return user;
}

/**
 * Deletes the session in the request cookie, if any.
 * @param {Request} request
 * @param {Env} env
 */
export async function destroySession(request, env) {
  const token = readSessionToken(request);
  if (token)
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(await sha256Hex(token))
      .run();
}

/**
 * @param {SessionUser | undefined} user
 * @param {'owner' | 'admin' | 'member'} minRole
 * @returns {SessionUser}
 */
export function requireRole(user, minRole) {
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required');
  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
    throw new HttpError(403, 'forbidden', `This needs the ${minRole} role`);
  }
  return user;
}

/**
 * State-changing requests must come from our own origin (CSRF defence on top of SameSite=Lax).
 * @param {Request} request
 * @param {URL} url
 */
export function checkOrigin(request, url) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin !== url.origin) throw new HttpError(403, 'bad_origin', 'Cross-origin request rejected');
}

/**
 * Applies a Workers Rate Limiting binding; throws 429 when over the limit.
 * @param {RateLimit | undefined} limiter
 * @param {string} key
 */
export async function rateLimit(limiter, key) {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, 'rate_limited', 'Too many requests, slow down');
}

/** @param {Request} request */
export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

/**
 * Signs a user out everywhere except the session making this request.
 * @param {Request} request
 * @param {Env} env
 * @param {string} userId
 */
export async function destroyOtherSessions(request, env, userId) {
  const token = readSessionToken(request);
  const keep = token ? await sha256Hex(token) : '';
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(userId, keep).run();
}
