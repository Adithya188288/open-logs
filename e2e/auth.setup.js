import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures.js';

test('first sign-in with ADMIN_PASSWORD creates the owner and a Default project', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('First sign-in uses the')).toBeVisible();
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard\?project=prj_/);
  await expect(page.getByTestId('project-switcher')).toHaveText(/Default/);
  await expect(page.getByTestId('dashboard-switcher')).toHaveText(/Overview/);
  await page.context().storageState({ path: 'e2e/.auth/owner.json' });
});
