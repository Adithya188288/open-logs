// Basin SQL now and then never answers a query. The app must still open: only the parts that show log data
// may wait. Here every chart query is held forever, on a project that has sources (so charts are loaded).
import { expect, seed, test } from '../fixtures.js';

test('a Basin query that never answers does not freeze the app', async ({ page }) => {
  const { projectId } = seed();
  await page.route('**/api/aggregate', () => {});

  await page.goto(`/settings?project=${projectId}`);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 10_000 });

  await page.goto(`/dashboard?project=${projectId}`);
  await expect(page.getByTestId('project-switcher')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('chart').first()).toBeVisible();
  await expect(page.getByRole('status', { name: /^Loading / }).first()).toBeVisible();
});
