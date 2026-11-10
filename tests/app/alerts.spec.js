// Alerts on charts: the form, the Alerts page and an alert's page. No log data needed: incidents opening
// and resolving on real logs are checked in tests/basin/alerts.spec.js.
import { expect, named, TEST_WEBHOOK, test } from '../fixtures.js';

test.skip(!TEST_WEBHOOK, 'Set OPEN_LOGS_TEST_WEBHOOK to a request catcher URL');

/** A project with a source (so its dashboard shows charts) and its Overview dashboard's charts. */
async function projectWithCharts(/** @type {any} */ app, /** @type {string} */ what) {
  const { project } = await app.post('/api/projects', { name: named(what) });
  await app.post(`/api/projects/${project.id}/sources`, { name: 'api' });
  const { dashboards } = await app.get(`/api/projects/${project.id}/dashboards`);
  const { charts } = await app.get(`/api/dashboards/${dashboards[0].id}`);
  return { project, dashboard: dashboards[0], charts };
}

test('add an alert from a chart, then find, pause, edit and delete it', async ({ page, app }) => {
  const { project } = await projectWithCharts(app, 'alert-form');
  await page.goto(`/dashboard?project=${project.id}`);
  const errors = page
    .getByTestId('chart')
    .filter({ has: page.getByRole('heading', { name: 'Errors', exact: true }) });
  await errors.getByRole('button', { name: 'Chart options for Errors' }).click();
  await page.getByRole('menuitem', { name: 'Add alert' }).click();
  const drawer = page.getByRole('dialog', { name: 'Add alert' });
  await expect(drawer.getByTestId('alert-chart')).toContainText('level:error,fatal');
  await expect(drawer.getByTestId('alert-chart')).toContainText('Number of logs');

  // Nothing is saved until the form is right.
  await drawer.getByLabel('Alert name').fill('');
  await drawer.getByLabel('Webhook URL').fill('http://example.com/hook');
  await drawer.getByRole('button', { name: 'Create alert' }).click();
  await expect(drawer.getByText('Enter a name.')).toBeVisible();
  await expect(drawer.getByText('Enter a number above 0.')).toBeVisible();
  await expect(drawer.getByText('Enter a webhook URL starting with https://')).toBeVisible();

  await drawer.getByLabel('Alert name').fill('Errors spike');
  await drawer.getByLabel('Threshold').fill('5');
  await drawer.getByLabel('Webhook URL').fill(TEST_WEBHOOK);
  await drawer.getByRole('button', { name: 'Send test' }).click();
  await expect(drawer.getByTestId('webhook-test')).toHaveText('Test sent: the URL answered 200.');
  await drawer.getByLabel('After an incident resolves, wait before opening a new one').selectOption('120');
  await drawer.getByRole('button', { name: 'Create alert' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(errors.getByTestId('chart-alert')).toBeVisible();

  await page.getByRole('link', { name: 'Alerts', exact: true }).click();
  const row = page.getByTestId('alert-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Errors spike');
  await expect(row).toContainText('More than 5 logs in 5 min');
  await expect(row).toContainText('All good');

  await row.getByRole('link', { name: 'Errors spike' }).click();
  await expect(page).toHaveURL(/\/alert\?project=.*&id=alr_/);
  await expect(page.getByTestId('no-open-incident')).toHaveText('All good. Nothing has triggered yet.');
  await expect(page.locator('.stats-row')).toContainText('2 hours');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByTestId('no-open-incident')).toHaveText('This alert is paused, so it isn’t checked.');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit alert' });
  await expect(edit.getByLabel('Threshold')).toHaveValue('5');
  await edit.getByLabel('Condition').selectOption('increase');
  await edit.getByLabel('Threshold').fill('50');
  await edit.getByLabel('Time period').selectOption('30');
  await edit.getByRole('button', { name: 'Save alert' }).click();
  await expect(page.locator('.stats-row')).toContainText('Logs up 50% on the 30 min before');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete alert' }).click();
  await expect(page).toHaveURL(/\/alerts\?project=/);
  await expect(page.getByTestId('no-alerts')).toBeVisible();
});

test('any chart can have an alert, and the API refuses bad settings', async ({ page, app, baseURL }) => {
  const { project, dashboard } = await projectWithCharts(app, 'alert-api');
  const { chart } = await app.post(`/api/dashboards/${dashboard.id}/charts`, {
    title: 'Checkout p95',
    filter: { where: [{ field: 'fields.route', op: '=', value: '/checkout' }] },
    field: 'fields.duration_ms',
    measure: 'p95',
    viz: 'line',
  });
  const good = {
    name: 'Slow checkout',
    kind: 'above',
    threshold: 800,
    window_minutes: 15,
    webhook_url: TEST_WEBHOOK,
  };
  const { alert } = await app.put(`/api/charts/${chart.id}/alert`, good);
  expect(alert.condition).toBe('p95 duration_ms above 800 in 15 min');
  expect(alert.quiet_minutes).toBe(5);

  const put = (/** @type {object} */ body) =>
    page.request.put(`/api/charts/${chart.id}/alert`, {
      data: { ...good, ...body },
      headers: { origin: String(baseURL) },
    });
  for (const bad of [
    { window_minutes: 10 },
    { window_minutes: 90 },
    { quiet_minutes: 90 },
    { quiet_minutes: 1500 },
    { threshold: 0 },
    { kind: 'below' },
    { webhook_url: 'http://example.com/hook' },
  ]) {
    expect((await put(bad)).status(), JSON.stringify(bad)).toBe(400);
  }
  expect((await put({ quiet_minutes: 1440 })).status()).toBe(200);

  // The chart carries its alert, and deleting the chart deletes the alert.
  const { charts } = await app.get(`/api/dashboards/${dashboard.id}`);
  expect(charts.find((/** @type {any} */ c) => c.id === chart.id).alert).toMatchObject({
    paused: false,
    open: false,
  });
  await app.del(`/api/charts/${chart.id}`);
  const { total } = await app.get(`/api/projects/${project.id}/alerts?page=1`);
  expect(total).toBe(0);
});

test('the Alerts page shows 12 per page and filters by status', async ({ page, app }) => {
  const { project, dashboard } = await projectWithCharts(app, 'alert-pages');
  for (let i = 1; i <= 13; i++) {
    const n = String(i).padStart(2, '0');
    const { chart } = await app.post(`/api/dashboards/${dashboard.id}/charts`, {
      title: `chart-${n}`,
      filter: { where: [] },
      measure: 'count',
      viz: 'number',
    });
    await app.put(`/api/charts/${chart.id}/alert`, {
      name: `alert-${n}`,
      kind: 'above',
      threshold: 1_000_000,
      window_minutes: 5,
      webhook_url: TEST_WEBHOOK,
    });
  }
  await page.goto(`/alerts?project=${project.id}`);
  await expect(page.getByTestId('alert-row')).toHaveCount(12);
  await expect(page.getByTestId('alert-row').first()).toContainText('alert-13');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('alert-row')).toHaveCount(1);
  await expect(page.getByTestId('alert-row')).toContainText('alert-01');
  await page.getByLabel('Status').selectOption('open');
  await expect(page.getByText('No alerts match this status.')).toBeVisible();
  await page.getByLabel('Status').selectOption('ok');
  await expect(page.getByTestId('alert-row')).toHaveCount(12);
});
