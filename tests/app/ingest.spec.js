// The ingest rules, checked through the API. Nothing here is accepted, so nothing reaches Basin.
import { expect, named, test } from '../fixtures.js';

test('ingest rejects bad tokens and bad bodies', async ({ app, playwright, baseURL }) => {
  const { project } = await app.post('/api/projects', { name: named('ingest') });
  const { token } = await app.post(`/api/projects/${project.id}/sources`, { name: 'api' });
  const client = await playwright.request.newContext({ baseURL });
  const send = (/** @type {string} */ auth, /** @type {unknown} */ data) =>
    client.post('/v1/logs', { data, headers: { authorization: auth, 'content-type': 'application/json' } });

  expect((await send('Bearer ol_not-a-real-token', { message: 'x' })).status()).toBe(401);
  expect((await send('', { message: 'x' })).status()).toBe(401);
  expect((await send(`Bearer ${token}`, [])).status()).toBe(400);
  expect((await send(`Bearer ${token}`, '{not json')).status()).toBe(400);
  const tooMany = Array.from({ length: 10_001 }, () => ({ message: 'x' }));
  expect((await send(`Bearer ${token}`, tooMany)).status()).toBe(413);
  await client.dispose();
});
