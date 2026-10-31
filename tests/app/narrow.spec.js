// Narrow windows (under 790 px): the sidebar becomes a drawer behind a top bar, so pages start on screen.
import { expect, test } from '../fixtures.js';

test('in a narrow window the page shows right away and the menu opens as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 760 });
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeInViewport();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeHidden();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(nav).toBeInViewport();
  await nav.getByRole('link', { name: 'Team' }).click();
  await expect(page).toHaveURL(/\/team/);
  await expect(nav).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeInViewport();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(nav).toBeHidden();
});
