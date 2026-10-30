import { expect, sampleEvents, test, uniq } from './fixtures.js';

async function seeded(app) {
  const ctx = await app.projectWithSource(uniq('dash'), 'worker');
  await app.send(ctx.token, sampleEvents(Date.now(), 40));
  return ctx;
}

test('Overview starter charts show numbers that match the query API', async ({ page, app }) => {
  const { project } = await seeded(app);
  await page.goto(`/dashboard?project=${project.id}`);
  await expect(page.getByTestId('dashboard-switcher')).toHaveText(/Overview/);
  const events = page
    .getByTestId('chart')
    .filter({ has: page.getByRole('heading', { name: 'Events', exact: true }) });
  const errors = page
    .getByTestId('chart')
    .filter({ has: page.getByRole('heading', { name: 'Errors', exact: true }) });
  await expect(events.getByTestId('chart-value')).toHaveText('40');
  await expect(errors.getByTestId('chart-value')).toHaveText('16');
});

test('build a chart → pin → reload → it is there with correct numbers', async ({ page, app }) => {
  const { project } = await seeded(app);
  await page.goto(`/dashboard?project=${project.id}`);
  await page.getByRole('button', { name: 'Add chart' }).click();
  const drawer = page.getByRole('dialog', { name: 'New chart' });
  await drawer.getByLabel('Title', { exact: true }).fill('Payment errors by code');
  await drawer.getByLabel('Filter', { exact: true }).fill('level:error');
  await drawer.getByLabel('Filter', { exact: true }).press('Enter');
  await drawer.getByLabel('Field', { exact: true }).selectOption('fields.code');
  await drawer.getByLabel('Measure', { exact: true }).selectOption('count');
  await drawer.getByRole('button', { name: 'Bar' }).click();
  await expect(drawer.getByTestId('preview')).toContainText('16 events');
  await drawer.getByRole('button', { name: /^Pin to / }).click();

  await page.reload();
  const tile = page.getByTestId('chart').filter({ hasText: 'Payment errors by code' });
  await expect(tile).toBeVisible();
  await expect(tile.locator('.hbar')).toHaveCount(1);
  await expect(tile.locator('.hbar')).toContainText('card_declined');

  const now = Date.now();
  const api = await page.request.post('/api/query', {
    headers: { origin: new URL(page.url()).origin },
    data: {
      project_id: project.id,
      from: now - 3_600_000,
      to: now + 1000,
      where: [
        { field: 'level', op: '=', value: 'error' },
        { field: 'fields.code', op: '=', value: 'card_declined' },
      ],
      limit: 500,
    },
  });
  const { events } = await api.json();
  await expect(tile.locator('.hbar b')).toHaveText(String(events.length));
});

test('chart tile menu: edit, duplicate, remove; Export CSV', async ({ page, app }) => {
  const { project } = await seeded(app);
  await page.goto(`/dashboard?project=${project.id}`);
  const tiles = page.getByTestId('chart');
  await expect(tiles).toHaveCount(6);

  await page.getByRole('button', { name: 'Chart options for Warnings' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(tiles).toHaveCount(7);
  await expect(tiles.last()).toContainText('Warnings (copy)');

  await page.getByRole('button', { name: 'Chart options for Warnings (copy)' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit chart' });
  await drawer.getByLabel('Title', { exact: true }).fill('Slow requests p95');
  await drawer.getByLabel('Filter', { exact: true }).fill('');
  await drawer.getByLabel('Field', { exact: true }).selectOption('fields.duration_ms');
  await drawer.getByLabel('Measure', { exact: true }).selectOption('p95');
  await drawer.getByRole('button', { name: 'Line' }).click();
  await drawer.getByRole('button', { name: 'Save chart' }).click();
  await expect(tiles.last()).toContainText('Slow requests p95');
  await expect(tiles.last().locator('svg.line-svg')).toBeVisible();

  await page.getByRole('button', { name: 'Chart options for Slow requests p95' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Slow-requests-p95.csv');

  await page.getByRole('button', { name: 'Chart options for Slow requests p95' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Remove chart' }).click();
  await expect(tiles).toHaveCount(6);
  await expect(page.locator('header.topbar').getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
});

test('dashboards: switch, create, rename, delete with DELETE from the title menu', async ({ page, app }) => {
  const { project } = await seeded(app);
  await page.goto(`/dashboard?project=${project.id}`);
  await page.getByTestId('dashboard-switcher').click();
  await page.getByRole('menuitem', { name: 'New dashboard' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Payments');
  await page.getByRole('button', { name: 'Create dashboard' }).click();
  await expect(page.getByTestId('dashboard-switcher')).toHaveText(/Payments/);
  await expect(page.getByText('No charts yet')).toBeVisible();
  await page.getByTestId('dashboard-switcher').click();
  await expect(page.getByTestId('dashboard-link')).toHaveText(['Overview', 'Payments']);

  await page.getByRole('menuitem', { name: 'Rename this dashboard' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Billing');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByTestId('dashboard-switcher')).toHaveText(/Billing/);

  await page.getByTestId('dashboard-switcher').click();
  await page.getByRole('menuitem', { name: 'Delete this dashboard' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete dashboard' }).click();
  await expect(page.getByTestId('dashboard-switcher')).toHaveText(/Overview/);
  await page.getByTestId('dashboard-switcher').click();
  await expect(page.getByTestId('dashboard-link')).toHaveText(['Overview']);
});

test('"Chart" on a live tail field opens the chart builder for that field', async ({ page, app }) => {
  const { project } = await seeded(app);
  await page.goto(`/tail?project=${project.id}`);
  await page.getByTestId('event').filter({ hasText: 'POST /checkout 200' }).first().locator('.row').click();
  const panel = page.getByRole('complementary', { name: 'Event details' });
  await panel
    .locator('.f')
    .filter({ hasText: /^duration_ms/ })
    .getByRole('link', { name: 'Chart' })
    .click();
  const drawer = page.getByRole('dialog', { name: 'New chart' });
  await expect(drawer.getByLabel('Field', { exact: true })).toHaveValue('fields.duration_ms');
  await expect(drawer.getByLabel('Measure', { exact: true })).toHaveValue('p95');
  await expect(drawer.getByTestId('preview')).toContainText('10,000 ms');
});
