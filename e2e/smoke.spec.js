import { expect, test } from '@playwright/test';

test('serves the app', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Open Logs/);
});
