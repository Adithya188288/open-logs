import { exports } from 'cloudflare:workers';

export const ORIGIN = 'http://localhost';
export const ADMIN_EMAIL = 'owner@example.com';
export const ADMIN_PASSWORD = 'test-admin-password';

/**
 * Calls the Worker like a browser would: same-origin, JSON body, optional session cookie.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, cookie?: string, headers?: Record<string, string> }} [opts]
 */
export async function api(path, opts = {}) {
  const headers = new Headers(opts.headers);
  if (!headers.has('origin')) headers.set('origin', ORIGIN);
  // A fresh client IP per call keeps the sign-in rate limiter out of unrelated tests.
  if (!headers.has('cf-connecting-ip'))
    headers.set('cf-connecting-ip', `10.0.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  let body;
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const res = await exports.default.fetch(`${ORIGIN}${path}`, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { res, status: res.status, json, text };
}

/** @param {Response} res */
export function sessionCookie(res) {
  const set = res.headers.get('set-cookie') ?? '';
  const match = set.match(/ol_session=([^;]*)/);
  return match ? `ol_session=${match[1]}` : '';
}

/** Signs in with ADMIN_PASSWORD (creating the owner on first use) and returns the cookie. */
export async function signInOwner() {
  const { res, status } = await api('/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (status !== 200) throw new Error(`owner sign-in failed: ${status}`);
  return sessionCookie(res);
}

/**
 * Sends logs to the ingest endpoint with a source token.
 * @param {string} token
 * @param {unknown} body
 */
export async function ingest(token, body) {
  const res = await exports.default.fetch(`${ORIGIN}/v1/logs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { res, status: res.status, json: await res.json().catch(() => null) };
}

/** Creates a project and a source; returns ids and the one-time token. */
export async function createProjectWithSource(cookie, projectName = 'checkout-app', sourceName = 'api') {
  const project = await api('/api/projects', { cookie, body: { name: projectName } });
  const source = await api(`/api/projects/${project.json.project.id}/sources`, {
    cookie,
    body: { name: sourceName },
  });
  return { project: project.json.project, source: source.json.source, token: source.json.token };
}
