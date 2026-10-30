import { expect, test, uniq } from './fixtures.js';

test('New source modal: name → snippet with token once → listening → first event', async ({
  page,
  app,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { project } = await app.post('/api/projects', { name: uniq('src') });
  await page.goto(`/sources?project=${project.id}`);
  await expect(page.getByTestId('no-sources')).toBeVisible();

  await page.getByRole('button', { name: 'New source' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New source' });
  await dialog.getByLabel('Name').fill('worker');
  await dialog.getByRole('button', { name: 'Create source' }).click();

  const token = await dialog.getByTestId('token').textContent();
  expect(token).toMatch(/^ol_[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button', { name: /^Python/ }).click();
  await expect(dialog.getByTestId('snippet')).toContainText('urllib.request');
  await dialog.getByRole('button', { name: /^HTTP/ }).click();
  await expect(dialog.getByTestId('snippet')).toContainText('curl -X POST');
  await dialog.getByRole('button', { name: 'Copy token' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);

  await expect(dialog.getByTestId('verify')).toContainText('Listening for the first event from worker');
  await app.send(token, { level: 'info', message: 'hello from e2e' });
  await expect(dialog.getByTestId('verify')).toContainText('First event received from worker', {
    timeout: 10_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByTestId('source-row')).toHaveCount(1);
  await expect(page.getByTestId('source-row')).toContainText('Receiving');
  await page.reload();
  await expect(page.getByTestId('token')).toHaveCount(0);
});

test('Source detail: stats, rename, regenerate, delete with DELETE', async ({ page, app }) => {
  const { project, token } = await app.projectWithSource(uniq('detail'), 'api');
  await app.send(token, [{ message: 'one' }, { message: 'two' }]);
  await page.goto(`/sources?project=${project.id}`);
  await page.getByTestId('source-row').getByRole('link', { name: 'api' }).click();
  await expect(page).toHaveURL(/\/source\?project=.*&id=src_/);
  await expect(page.getByTestId('events-24h')).toHaveText('2');
  await expect(page.getByRole('link', { name: 'Open live tail →' })).toHaveAttribute('href', /source=api/);

  await page.getByRole('button', { name: 'Rename source' }).click();
  await page.getByRole('dialog', { name: 'Rename source' }).getByLabel('Name').fill('billing-api');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.locator('.crumbs h1')).toHaveText('billing-api');

  await page.getByRole('button', { name: 'Regenerate token' }).click();
  await page.getByRole('button', { name: 'Regenerate token' }).last().click();
  const fresh = await page.getByRole('dialog', { name: 'New token' }).getByTestId('token').textContent();
  expect(fresh).not.toBe(token);
  const old = await page.request.post('/v1/logs', {
    data: { message: 'x' },
    headers: { authorization: `Bearer ${token}` },
  });
  expect(old.status()).toBe(401);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete source' })).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete source' }).click();
  await expect(page).toHaveURL(/\/sources\?project=/);
  await expect(page.getByTestId('no-sources')).toBeVisible();
});
