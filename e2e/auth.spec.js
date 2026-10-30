import { ADMIN_EMAIL, ADMIN_PASSWORD, expect, test, uniq } from './fixtures.js';

test.describe('sign in, sign out, invite', () => {
  test('rejects a wrong password with a generic error, then signs in and out', async ({ browser, theme }) => {
    const context = await browser.newContext({ storageState: undefined, colorScheme: theme });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');

    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();

    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?next=%2F/);
    await context.close();
  });

  test('owner invites a teammate who sets a password and gets in', async ({ page, browser }) => {
    const email = `${uniq('mate')}@e2e.test`;
    await page.goto('/');
    await page.getByLabel('Teammate email').fill(email);
    await page.getByLabel('Role').selectOption('admin');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const link = await page.getByTestId('invite-url').textContent();
    expect(link).toMatch(/\/invite#ol_inv_/);
    await expect(page.getByRole('row').filter({ hasText: email })).toContainText('Admin');

    const context = await browser.newContext({ storageState: undefined });
    const mate = await context.newPage();
    await mate.goto(link);
    await expect(mate.getByRole('heading', { name: /^Join / })).toBeVisible();
    await mate.getByLabel('Your name').fill('Mate');
    await mate.getByLabel('Choose a password').fill('mate-password-1');
    await mate.getByRole('button', { name: 'Join team' }).click();
    await expect(mate.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await expect(mate.locator('.nav .me')).toContainText('Mate');

    await mate.goto(link);
    await expect(mate.getByRole('heading', { name: 'Invite not valid' })).toBeVisible();
    await context.close();
  });

  test('theme choice is remembered across pages', async ({ page, theme }) => {
    await page.goto('/');
    const html = page.locator('html');
    if (theme === 'dark') await expect(html).toHaveAttribute('data-theme', 'dark');
    else await expect(html).not.toHaveAttribute('data-theme', 'dark');

    await page.getByTestId('theme-toggle').click();
    const flipped = theme === 'dark' ? 'light' : 'dark';
    await page.goto('/login');
    if (flipped === 'dark') await expect(html).toHaveAttribute('data-theme', 'dark');
    else await expect(html).not.toHaveAttribute('data-theme', 'dark');
    await page.goto('/');
    await page.getByTestId('theme-toggle').click();
  });
});
