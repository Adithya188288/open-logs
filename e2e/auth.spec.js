import { ADMIN_EMAIL, ADMIN_PASSWORD, expect, test, uniq } from './fixtures.js';

test.describe('sign in, sign out, team, settings', () => {
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
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?next=%2F/);
    await context.close();
  });

  test('sign-in never redirects off-site', async ({ browser, theme }) => {
    const context = await browser.newContext({ storageState: undefined, colorScheme: theme });
    const page = await context.newPage();
    await page.goto('/login?next=/%09/evil.example');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForLoadState();
    expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL).host);
    await context.close();
  });

  test('Team screen: invite shows the link and email status; teammate joins', async ({ page, browser }) => {
    const email = `${uniq('mate')}@e2e.test`;
    await page.goto('/team');
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
    await expect(page.getByTestId('member-row').filter({ hasText: ADMIN_EMAIL })).toContainText('Owner');
    await page.getByRole('button', { name: 'Invite teammate' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Role').selectOption('admin');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByTestId('invite-email-status')).toContainText('Email sending isn’t set up');
    const link = await page.getByTestId('invite-url').textContent();
    expect(link).toMatch(/\/invite#ol_inv_/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('invite-row').filter({ hasText: email })).toContainText('Admin');

    const context = await browser.newContext({ storageState: undefined });
    const mate = await context.newPage();
    await mate.goto(link);
    await mate.getByLabel('Your name').fill('Mate');
    await mate.getByLabel('Choose a password').fill('mate-password-1');
    await mate.getByRole('button', { name: 'Join team' }).click();
    await expect(mate).toHaveURL(/\/dashboard/);
    await expect(mate.locator('.nav .me')).toContainText('Mate');
    await context.close();
  });

  test('removing a teammate needs DELETE typed', async ({ page, app, playwright, baseURL }) => {
    const email = `${uniq('gone')}@e2e.test`;
    const inv = await app.post('/api/invites', { email, role: 'member' });
    const token = inv.invite_url.split('#')[1];
    // Accept in a separate context so this page stays signed in as the owner.
    const other = await playwright.request.newContext({ baseURL });
    const accepted = await other.post(`/api/invites/${token}/accept`, {
      data: { name: 'Gone', password: 'gone-password' },
      headers: { origin: baseURL },
    });
    expect(accepted.ok()).toBeTruthy();
    await other.dispose();
    await page.goto('/team');
    const row = page.getByTestId('member-row').filter({ hasText: email });
    await row.getByRole('button', { name: 'Remove' }).click();
    const confirm = page.getByRole('button', { name: 'Remove teammate' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('delete');
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await confirm.click();
    await expect(page.getByTestId('member-row').filter({ hasText: email })).toHaveCount(0);
  });

  test('Settings: team name and password', async ({ page, theme }) => {
    await page.goto('/settings');
    const name = `Team ${theme}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.nav .brand')).toContainText(name);
    await page.getByLabel('Current password').fill('not-my-password');
    await page.getByLabel('New password', { exact: true }).fill('something-new-1');
    await page.getByLabel('New password again').fill('something-new-1');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'incorrect' })).toBeVisible();
  });

  test('theme choice is remembered across pages', async ({ page, theme }) => {
    await page.goto('/projects');
    const html = page.locator('html');
    if (theme === 'dark') await expect(html).toHaveAttribute('data-theme', 'dark');
    else await expect(html).not.toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await page.goto('/login');
    if (theme === 'dark') await expect(html).not.toHaveAttribute('data-theme', 'dark');
    else await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.goto('/projects');
    await page.getByTestId('theme-toggle').click();
  });
});
