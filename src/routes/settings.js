// Settings screen: team name, and changing your own password.
import { destroyOtherSessions, rateLimit, requireRole } from '../auth.js';
import { hashPassword, verifyPassword } from '../crypto.js';
import { asObject, HttpError, json, readJson, requirePassword, requireString } from '../http.js';
import { teamName } from '../settings.js';

/** @param {import('../types.js').RouteContext} c */
export async function getSettings({ env }) {
  return json({ settings: { team_name: await teamName(env) } });
}

/** @param {import('../types.js').RouteContext} c */
export async function updateSettings({ request, env, user }) {
  requireRole(user, 'admin');
  const body = asObject(await readJson(request));
  const name = requireString(body.team_name, 'team_name', { max: 60 });
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('team_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(name)
    .run();
  return json({ settings: { team_name: name } });
}

/** @param {import('../types.js').RouteContext} c */
export async function changePassword({ request, env, user }) {
  const me = requireRole(user, 'member');
  const body = asObject(await readJson(request));
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  const next = requirePassword(body.new_password, 'new_password');
  await rateLimit(env.LOGIN_LIMITER, `pw:${me.id}`);
  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
    .bind(me.id)
    .first();
  if (!row || !(await verifyPassword(current, String(row.password_hash), String(row.password_salt)))) {
    throw new HttpError(400, 'wrong_password', 'Your current password is incorrect');
  }
  const { hash, salt } = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(hash, salt, me.id)
    .run();
  await destroyOtherSessions(request, env, me.id);
  return json({ ok: true });
}
