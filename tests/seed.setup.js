// Runs first. Signs the owner in through the login page (the first sign-in on a new install creates the owner),
// then creates this run's project with two sources and sends their logs, so Basin's ~2 minute delay runs
// while the app tests do. Writes what it made to tests/.state/seed.json for the Basin tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, OWNER_EMAIL, OWNER_PASSWORD, named, SEED_FILE, sampleEvents, test } from './fixtures.js';

test('sign in, create a project with two sources, send logs', async ({ page, baseURL }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard\?project=prj_/);
  mkdirSync('tests/.state', { recursive: true });
  await page.context().storageState({ path: 'tests/.state/owner.json' });

  /** @param {string} method @param {string} path @param {unknown} data */
  const call = async (method, path, data) => {
    const res = await page.request.fetch(path, { method, data, headers: { origin: String(baseURL) } });
    expect(res.ok(), `${method} ${path} → ${res.status()}`).toBeTruthy();
    return res.json();
  };
  const { project } = await call('POST', '/api/projects', { name: named('logs') });
  const sources = {};
  for (const [name, n] of /** @type {const} */ ([
    ['api', 40],
    ['worker', 10],
  ])) {
    const { source, token } = await call('POST', `/api/projects/${project.id}/sources`, { name });
    const sent = await page.request.post('/v1/logs', {
      data: sampleEvents(n),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(sent.status()).toBe(202);
    expect(await sent.json()).toEqual({ accepted: n });
    sources[name] = { id: source.id, token, sent: n };
  }
  writeFileSync(
    SEED_FILE,
    JSON.stringify({ projectId: project.id, sentAt: Date.now(), sources, errors: 16 + 4 }, null, 2),
  );
});
