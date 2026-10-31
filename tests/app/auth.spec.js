import { expect, OWNER_EMAIL, OWNER_PASSWORD, test } from '../fixtures.js';

test('a wrong password gets a generic error; sign out, then sign back in', async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');

  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

test('the API refuses requests without a session', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get('/api/projects')).status()).toBe(401);
  expect((await anonymous.get('/api/me')).status()).toBe(401);
  await anonymous.dispose();
});
