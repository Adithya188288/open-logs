import { expect, named, OWNER_EMAIL, test } from '../fixtures.js';

test('invite a teammate, they join and change their password, then they are removed', async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const email = `${named('mate')}@e2e.test`;
  await page.goto('/team');
  await expect(page.getByTestId('member-row').filter({ hasText: OWNER_EMAIL })).toContainText('Owner');
  await page.getByRole('button', { name: 'Invite teammate' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role').selectOption('member');
  await page.getByRole('button', { name: 'Send invite' }).click();
  const link = await page.getByTestId('invite-url').textContent();
  expect(link).toMatch(/\/invite#ol_inv_/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('invite-row').filter({ hasText: email })).toBeVisible();

  const mateContext = await browser.newContext({ storageState: undefined });
  const mate = await mateContext.newPage();
  await mate.goto(String(link));
  await mate.getByLabel('Your name').fill('Mate');
  await mate.getByLabel('Choose a password').fill('mate-password-1');
  await mate.getByRole('button', { name: 'Join team' }).click();
  await expect(mate).toHaveURL(/\/dashboard/);

  await mate.goto('/settings');
  await mate.getByLabel('Current password').fill('mate-password-1');
  await mate.getByLabel('New password', { exact: true }).fill('mate-password-2');
  await mate.getByLabel('New password again').fill('mate-password-2');
  await mate.getByRole('button', { name: 'Change password' }).click();
  const signIn = async (/** @type {string} */ password) => {
    const fresh = await playwright.request.newContext({ baseURL });
    const res = await fresh.post('/api/auth/login', {
      data: { email, password },
      headers: { origin: String(baseURL) },
    });
    await fresh.dispose();
    return res.status();
  };
  await expect.poll(() => signIn('mate-password-2')).toBe(200);
  expect(await signIn('mate-password-1')).toBe(401);

  await page.reload();
  const row = page.getByTestId('member-row').filter({ hasText: email });
  await row.getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('button', { name: 'Remove teammate' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();
  await expect(page.getByTestId('member-row').filter({ hasText: email })).toHaveCount(0);
  expect((await mate.request.get('/api/me')).status()).toBe(401);
  await mateContext.close();
});
