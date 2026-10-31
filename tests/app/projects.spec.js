import { expect, named, test } from '../fixtures.js';

test('create a project from the switcher, rename it, delete it with DELETE typed', async ({ page }) => {
  const name = named('project');
  await page.goto('/projects');
  await page.getByTestId('project-switcher').click();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/sources\?project=prj_/);
  await expect(page.getByTestId('project-switcher')).toHaveText(new RegExp(name));
  await expect(page.getByTestId('no-sources')).toBeVisible();

  await page.goto('/projects');
  const card = () => page.getByTestId('project-card').filter({ hasText: name });
  await card()
    .getByRole('button', { name: `Options for ${name}` })
    .click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page
    .getByRole('dialog', { name: 'Rename project' })
    .getByLabel('Project name')
    .fill(`${name}-renamed`);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const renamed = page.getByTestId('project-card').filter({ hasText: `${name}-renamed` });
  await expect(renamed).toBeVisible();

  await renamed.getByRole('button', { name: `Options for ${name}-renamed` }).click();
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  const confirm = page.getByRole('button', { name: 'Delete project' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('delete');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();
  await expect(page.getByTestId('project-card').filter({ hasText: name })).toHaveCount(0);
});
