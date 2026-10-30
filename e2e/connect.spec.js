import { expect, test, uniq } from './fixtures.js';

test('connect a source: name → platform → token once → listening → first event', async ({
  page,
  app,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { project } = await app.post('/api/projects', { name: uniq('connect') });
  await page.goto(`/connect?project=${project.id}`);

  await page.getByLabel('One source per service').fill('worker');
  await page.getByRole('button', { name: 'Create source' }).click();

  const token = await page.getByTestId('token').textContent();
  expect(token).toMatch(/^ol_[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText('Token shown once')).toBeVisible();

  await page.getByRole('button', { name: /^Python/ }).click();
  await expect(page.getByTestId('snippet')).toContainText('urllib.request');
  await page.getByRole('button', { name: /^HTTP/ }).click();
  await expect(page.getByTestId('snippet')).toContainText('curl -X POST');
  await expect(page.getByTestId('snippet')).toContainText('/v1/logs');

  await page.getByRole('button', { name: 'Copy token' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);

  await expect(page.getByTestId('verify')).toContainText('Listening for the first event from worker');
  await app.send(token, { level: 'info', message: 'hello from e2e' });
  await expect(page.getByTestId('verify')).toContainText('First event received from worker', {
    timeout: 10_000,
  });

  await page.reload();
  await expect(page.getByTestId('token')).toHaveCount(0);
  await expect(page.getByTestId('source-row')).toContainText('worker');
});

test('regenerating a token shows the new one once and the old one stops working', async ({ page, app }) => {
  const { project, token } = await app.projectWithSource(uniq('regen'), 'api');
  await page.goto(`/connect?project=${project.id}`);
  await page.getByTestId('source-row').getByRole('button', { name: 'Regenerate token' }).click();
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  const fresh = await page.getByTestId('token').textContent();
  expect(fresh).not.toBe(token);
  const old = await page.request.post('/v1/logs', {
    data: { message: 'x' },
    headers: { authorization: `Bearer ${token}` },
  });
  expect(old.status()).toBe(401);
});
