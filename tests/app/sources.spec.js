import { expect, named, test } from '../fixtures.js';

test('new source: token shown once and copyable; the first event is noticed', async ({
  page,
  app,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { project } = await app.post('/api/projects', { name: named('new-source') });
  await page.goto(`/sources?project=${project.id}`);
  await expect(page.getByTestId('no-sources')).toBeVisible();

  await page.getByRole('button', { name: 'New source' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New source' });
  await dialog.getByLabel('Name').fill('web');
  await dialog.getByRole('button', { name: 'Create source' }).click();
  const token = await dialog.getByTestId('token').textContent();
  expect(token).toMatch(/^ol_[A-Za-z0-9_-]{43}$/);
  await expect(dialog.getByTestId('verify')).toContainText('Waiting for the first event from web');
  await dialog.getByRole('button', { name: 'Copy token' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);

  const sent = await page.request.post('/v1/logs', {
    data: { message: 'hello from the e2e run' },
    headers: { authorization: `Bearer ${token}` },
  });
  expect(sent.status()).toBe(202);
  // The first log is recorded once in D1, so this shows within seconds, well before Basin has the log.
  await expect(dialog.getByTestId('verify')).toContainText('First event received from web', {
    timeout: 20_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('source-row')).toHaveCount(1);
  await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Created', '']);

  await page.reload();
  await expect(page.getByTestId('token')).toHaveCount(0);
});

test('source page: rename, regenerate (old token stops working), delete with DELETE typed', async ({
  page,
  app,
}) => {
  const { project } = await app.post('/api/projects', { name: named('source-page') });
  const { source, token } = await app.post(`/api/projects/${project.id}/sources`, { name: 'api' });
  await page.goto(`/sources?project=${project.id}`);
  await page.getByTestId('source-row').getByRole('link', { name: 'api' }).click();
  await expect(page).toHaveURL(new RegExp(`id=${source.id}`));

  await page.getByRole('button', { name: 'Rename source' }).click();
  await page.getByRole('dialog', { name: 'Rename source' }).getByLabel('Name').fill('billing-api');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.locator('.crumbs h1')).toHaveText('billing-api');

  await page.getByRole('button', { name: 'Regenerate token' }).click();
  await page.getByRole('button', { name: 'Regenerate token' }).last().click();
  const fresh = await page.getByRole('dialog', { name: 'New token' }).getByTestId('token').textContent();
  expect(fresh).not.toBe(token);
  const send = (/** @type {string | null} */ t) =>
    page.request.post('/v1/logs', { data: { message: 'x' }, headers: { authorization: `Bearer ${t}` } });
  expect((await send(token)).status()).toBe(401);
  expect((await send(fresh)).status()).toBe(202);
  await page.keyboard.press('Escape');
  // The old token's request is recorded on the source; the first accepted log sets "First event".
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('alert').filter({ hasText: 'Requests are being rejected' })).toBeVisible({
      timeout: 2000,
    });
    await expect(page.locator('.stats-row')).not.toContainText('not yet', { timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Delete source' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();
  await expect(page).toHaveURL(/\/sources\?project=/);
  await expect(page.getByTestId('no-sources')).toBeVisible();
  expect((await send(fresh)).status()).toBe(401);
});

test('the sources table shows 12 per page', async ({ page, app }) => {
  const { project } = await app.post('/api/projects', { name: named('many-sources') });
  for (let i = 1; i <= 13; i++) {
    await app.post(`/api/projects/${project.id}/sources`, { name: `svc-${String(i).padStart(2, '0')}` });
  }
  await page.goto(`/sources?project=${project.id}`);
  await expect(page.getByTestId('source-row')).toHaveCount(12);
  // Newest first: the last one created leads page 1, the first one created is alone on page 2.
  await expect(page.getByTestId('source-row').first()).toContainText('svc-13');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('source-row')).toHaveCount(1);
  await expect(page.getByTestId('source-row')).toContainText('svc-01');
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
});
