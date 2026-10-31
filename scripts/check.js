// Proves an install works end to end: sign in, send a log through a temporary source, and wait until Basin
// can search it (usually 1.5–3.5 minutes after it arrives). Used by setup and update.
import { sleep } from './lib.js';

const WAIT_MS = 6 * 60_000;
const POLL_MS = 15_000;

/**
 * @param {string} url  the install's workers.dev URL
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function checkLogsFlow(url, email, password) {
  const call = async (/** @type {string} */ path, /** @type {RequestInit} */ init = {}, cookie = '') => {
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: { origin: url, 'content-type': 'application/json', cookie, ...init.headers },
    });
    return { res, body: await res.json().catch(() => ({})) };
  };

  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!login.res.ok) {
    console.error(`  Could not sign in (${login.res.status}).`);
    return false;
  }
  const cookie = String(login.res.headers.get('set-cookie')).split(';')[0];
  const { body: projects } = await call('/api/projects', {}, cookie);
  const project = projects.projects?.[0];
  const created = await call(
    `/api/projects/${project.id}/sources`,
    { method: 'POST', body: JSON.stringify({ name: `setup-check-${Date.now()}` }) },
    cookie,
  );
  const marker = `Open Logs setup check ${crypto.randomUUID()}`;
  const sent = await fetch(`${url}/v1/logs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.body.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'info', message: marker }),
  });
  if (sent.status !== 202) {
    console.error(`  Sending a test log failed (${sent.status}).`);
    return false;
  }

  const started = Date.now();
  let found = false;
  while (!found && Date.now() - started < WAIT_MS) {
    await sleep(POLL_MS);
    const { res, body } = await call(
      '/api/query',
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: project.id,
          from: started - 60_000,
          to: Date.now() + 60_000,
          where: [{ text: marker }],
          limit: 1,
        }),
      },
      cookie,
    );
    if (!res.ok) {
      console.error(`  Searching Basin failed (${res.status}): ${body.error?.message ?? 'unknown error'}`);
      return false;
    }
    found = body.events?.length === 1;
    process.stdout.write(
      found ? '' : `  … waiting for Basin (${Math.round((Date.now() - started) / 1000)}s)\n`,
    );
  }
  await call(`/api/sources/${created.body.source.id}`, { method: 'DELETE' }, cookie);
  return found;
}
