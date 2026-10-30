import { expect, sampleEvents, test, uniq } from './fixtures.js';

/** Makes the page believe its tab is hidden or visible, as switching browser tabs does. */
async function setTabVisible(page, visible) {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', {
      value: v ? 'visible' : 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

test('live tail makes no background requests while the tab is hidden, then catches up', async ({
  page,
  app,
}) => {
  const { project, token } = await app.projectWithSource(uniq('hidden'), 'api');
  await app.send(token, sampleEvents(Date.now(), 5));
  await page.goto(`/tail?project=${project.id}`);
  await expect(page.getByTestId('event')).toHaveCount(5);

  let polls = 0;
  page.on('request', (r) => r.url().includes('/api/query') && polls++);
  await setTabVisible(page, false);
  await app.send(token, { message: 'sent while hidden' });
  await page.waitForTimeout(7000); // more than two poll intervals locally
  expect(polls).toBe(0);
  await expect(page.getByTestId('event')).toHaveCount(5);

  await setTabVisible(page, true);
  await expect(page.getByTestId('event').first()).toContainText('sent while hidden');
});

test('Team and Settings load once and are kept when you come back', async ({ page }) => {
  await page.goto('/team');
  await expect(page.getByTestId('member-row').first()).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue('');

  let refetched = 0;
  page.on('request', (r) => /\/api\/(users|settings)$/.test(new URL(r.url()).pathname) && refetched++);
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page.getByTestId('member-row').first()).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue('');
  expect(refetched).toBe(0);
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
});

test('dashboard shows when it last updated and refreshes on demand', async ({ page, app }) => {
  const { project, token } = await app.projectWithSource(uniq('fresh'), 'api');
  await app.send(token, sampleEvents(Date.now(), 6));
  await page.goto(`/dashboard?project=${project.id}`);
  const freshness = page.getByTestId('dashboard-freshness');
  await expect(freshness).toContainText('Updated');

  let queried = 0;
  page.on('request', (r) => r.url().includes('/api/aggregate') && queried++);
  await freshness.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => queried).toBeGreaterThan(0);
});

test('coming back to the dashboard within 30s does not re-check for new data', async ({ page, app }) => {
  const { project, token } = await app.projectWithSource(uniq('recheck'), 'api');
  await app.send(token, sampleEvents(Date.now(), 3));
  await page.goto(`/dashboard?project=${project.id}`);
  await expect(page.getByTestId('dashboard-freshness')).toContainText('Updated');
  let checks = 0;
  page.on('request', (r) => r.url().includes('/api/status?project_id=') && checks++);
  for (let i = 0; i < 3; i++) {
    await page.locator('.nav a[href^="/sources"]').click();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByTestId('dashboard-freshness')).toBeVisible();
  }
  expect(checks).toBe(0);
});
