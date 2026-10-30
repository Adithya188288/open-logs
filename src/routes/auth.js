// Sign-in, sign-out, current user, invites and team management.
import { clearedCookie, clientIp, createSession, destroySession, rateLimit, requireRole } from '../auth.js';
import { hashPassword, newSecret, randomId, sha256Hex, timingSafeEqual, verifyPassword } from '../crypto.js';
import { asObject, EMAIL_RE, HttpError, json, readJson, requireString } from '../http.js';
import { teamName } from '../settings.js';
import { overviewStatements } from './boards.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_LOGIN = new HttpError(401, 'invalid_credentials', 'Invalid email or password');
// Verified against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY = { hash: '0'.repeat(64), salt: '00'.repeat(16) };

/** @param {Record<string, unknown>} row */
function publicUser(row) {
  const { id, email, name, role, created_at, last_active_at } = row;
  return { id, email, name, role, created_at, last_active_at };
}

/** @param {string} email */
function nameFromEmail(email) {
  const local = email.split('@')[0] ?? 'Owner';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** @param {unknown} value */
function passwordFrom(value) {
  return requireString(value, 'password', { min: 8, max: 256 });
}

/** @param {import('../types.js').RouteContext} c */
export async function login({ request, env }) {
  const body = asObject(await readJson(request));
  const email = requireString(body.email, 'email', { max: 254, pattern: EMAIL_RE }).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  await rateLimit(env.LOGIN_LIMITER, `${clientIp(request)}:${email}`);
  // A per-IP budget too, so rotating emails can't buy unlimited guesses.
  await rateLimit(env.LOGIN_IP_LIMITER, `ip:${clientIp(request)}`);

  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    const anyUser = await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
    if (!anyUser && env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 8) {
      if (!timingSafeEqual(password, env.ADMIN_PASSWORD)) throw INVALID_LOGIN;
      user = await createOwner(env, email, password);
      if (!user) throw INVALID_LOGIN;
    } else {
      await verifyPassword(password, DUMMY.hash, DUMMY.salt);
      throw INVALID_LOGIN;
    }
  } else if (!(await verifyPassword(password, String(user.password_hash), String(user.password_salt)))) {
    throw INVALID_LOGIN;
  }

  const setCookie = await createSession(env, String(user.id));
  return json({ user: publicUser(user) }, 200, { 'set-cookie': setCookie });
}

/**
 * Inserts the owner only if the users table is still empty (safe against concurrent first sign-ins).
 * @param {Env} env
 * @param {string} email
 * @param {string} password
 */
async function createOwner(env, email, password) {
  const { hash, salt } = await hashPassword(password);
  const id = randomId('usr');
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, password_salt, role, created_at, last_active_at)
     SELECT ?, ?, ?, ?, ?, 'owner', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, email, nameFromEmail(email), hash, salt, now, now)
    .run();
  if (!res.meta.changes) return null;
  // Every workspace starts with a Default project, so there's somewhere to send logs right away.
  const projectId = randomId('prj');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').bind(
      projectId,
      'Default',
      now,
    ),
    ...overviewStatements(env, projectId),
  ]);
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

/** @param {import('../types.js').RouteContext} c */
export async function logout({ request, env }) {
  await destroySession(request, env);
  return json({ ok: true }, 200, { 'set-cookie': clearedCookie() });
}

/** @param {import('../types.js').RouteContext} c */
export async function me({ user, env }) {
  return json({ user: requireRole(user, 'member'), team_name: await teamName(env) });
}

/** @param {import('../types.js').RouteContext} c */
export async function listUsers({ user, env }) {
  requireRole(user, 'member');
  const users = await env.DB.prepare(
    'SELECT id, email, name, role, created_at, last_active_at FROM users ORDER BY created_at',
  ).all();
  const invites = await env.DB.prepare(
    'SELECT id, email, role, created_at, expires_at FROM invites WHERE accepted_at IS NULL AND expires_at > ? ORDER BY created_at',
  )
    .bind(Date.now())
    .all();
  return json({ users: users.results, invites: invites.results });
}

/** @param {import('../types.js').RouteContext} c */
export async function deleteUser({ user, env, params }) {
  const me = requireRole(user, 'owner');
  if (params.id === me.id) throw new HttpError(400, 'cannot_remove_self', 'You cannot remove yourself');
  const [, res] = await env.DB.batch([
    // Pending invites they sent die with them (incl. admin invites).
    env.DB.prepare('DELETE FROM invites WHERE created_by = ? AND accepted_at IS NULL').bind(params.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(params.id),
  ]);
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'User not found');
  return json({ ok: true });
}

/** @param {import('../types.js').RouteContext} c */
export async function createInvite({ request, user, env, url }) {
  const me = requireRole(user, 'admin');
  const body = asObject(await readJson(request));
  const email = requireString(body.email, 'email', { max: 254, pattern: EMAIL_RE }).toLowerCase();
  if (body.role !== 'member' && body.role !== 'admin') {
    throw new HttpError(400, 'invalid_field', 'role must be member or admin', { field: 'role' });
  }
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'already_member', 'That person is already on the team');

  const token = newSecret('ol_inv_');
  const now = Date.now();
  const invite = {
    id: randomId('inv'),
    email,
    role: body.role,
    created_at: now,
    expires_at: now + INVITE_TTL_MS,
  };
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invites WHERE email = ? AND accepted_at IS NULL').bind(email),
    env.DB.prepare(
      'INSERT INTO invites (id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(invite.id, email, invite.role, await sha256Hex(token), me.id, now, invite.expires_at),
  ]);
  // The token sits in the URL fragment so it isn't sent on page load or in Referer headers. The invite page
  // does send it in /api/invites/:token requests; it is single-use and expires in 7 days.
  const inviteUrl = `${url.origin}/invite#${token}`;
  const emailStatus = await sendInviteEmail(env, { to: email, url: inviteUrl, from: me });
  return json({ invite, invite_url: inviteUrl, email: emailStatus }, 201);
}

/**
 * @param {Env} env
 * @param {string} token
 */
async function findOpenInvite(env, token) {
  if (!token.startsWith('ol_inv_') || token.length > 128) return null;
  return env.DB.prepare(
    'SELECT * FROM invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?',
  )
    .bind(await sha256Hex(token), Date.now())
    .first();
}

/** @param {import('../types.js').RouteContext} c */
export async function getInvite({ env, params }) {
  const invite = await findOpenInvite(env, params.token);
  if (!invite) throw new HttpError(404, 'not_found', 'This invite link is invalid or has expired');
  return json({
    invite: { email: invite.email, role: invite.role },
    team_name: await teamName(env),
  });
}

/** @param {import('../types.js').RouteContext} c */
export async function acceptInvite({ request, env, params }) {
  await rateLimit(env.LOGIN_LIMITER, `invite:${clientIp(request)}`);
  const body = asObject(await readJson(request));
  const name = requireString(body.name, 'name', { max: 80 });
  const password = passwordFrom(body.password);
  const invite = await findOpenInvite(env, params.token);
  if (!invite) throw new HttpError(404, 'not_found', 'This invite link is invalid or has expired');

  const { hash, salt } = await hashPassword(password);
  const id = randomId('usr');
  const now = Date.now();
  const claimed = await env.DB.prepare(
    'UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL',
  )
    .bind(now, invite.id)
    .run();
  if (!claimed.meta.changes)
    throw new HttpError(404, 'not_found', 'This invite link is invalid or has expired');
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, password_hash, password_salt, role, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, invite.email, name, hash, salt, invite.role, now, now)
      .run();
  } catch {
    throw new HttpError(409, 'already_member', 'That person is already on the team');
  }
  const setCookie = await createSession(env, id);
  const user = { id, email: invite.email, name, role: invite.role, created_at: now, last_active_at: now };
  return json({ user }, 200, { 'set-cookie': setCookie });
}

/**
 * Emails the invite link when Cloudflare Email Service is configured (EMAIL binding + EMAIL_FROM).
 * The link is always returned to the inviter too, so a failed or unconfigured send never blocks an invite.
 * @param {Env} env
 * @param {{ to: string, url: string, from: { name: string } }} o
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendInviteEmail(env, o) {
  if (!env.EMAIL || !env.EMAIL_FROM) return { sent: false, reason: 'not_configured' };
  const team = await teamName(env);
  try {
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
      to: o.to,
      subject: `${o.from.name} invited you to ${team} on Open Logs`,
      text: `${o.from.name} invited you to join ${team} on Open Logs.\n\nAccept the invite (valid for 7 days):\n${o.url}\n`,
    });
    return { sent: true };
  } catch (err) {
    console.error('invite email failed', err instanceof Error ? err.message : err);
    return { sent: false, reason: 'send_failed' };
  }
}
