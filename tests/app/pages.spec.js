import { expect, named, test } from '../fixtures.js';

test('every screen opens without errors', async ({ page, app }) => {
  const { project } = await app.post('/api/projects', { name: named('pages') });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const [path, heading] of [
    ['/projects', 'Projects'],
    [`/sources?project=${project.id}`, 'Sources'],
    [`/dashboard?project=${project.id}`, null],
    [`/tail?project=${project.id}`, null],
    [`/alerts?project=${project.id}`, 'Alerts'],
    ['/team', 'Team'],
    ['/settings', 'Settings'],
  ]) {
    await page.goto(path);
    if (heading) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('team name change shows in the sidebar', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Name', { exact: true }).fill(named('team'));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.nav .brand')).toContainText(named('team'));
});

test('the theme toggle switches and is remembered after a reload', async ({ page }) => {
  await page.goto('/projects');
  const html = page.locator('html');
  const dark = async () => (await html.getAttribute('data-theme')) === 'dark';
  const before = await dark();
  await page.getByTestId('theme-toggle').click();
  expect(await dark()).toBe(!before);
  await page.reload();
  expect(await dark()).toBe(!before);
  await page.getByTestId('theme-toggle').click();
  expect(await dark()).toBe(before);
});
