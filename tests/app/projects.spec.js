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
  await page.getByLabel('Find a project').fill(name);
  const row = page.getByTestId('project-row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.locator('td').nth(1)).toHaveText('0');
  await row.getByRole('button', { name: `Options for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page
    .getByRole('dialog', { name: 'Rename project' })
    .getByLabel('Project name')
    .fill(`${name}-renamed`);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const renamed = page.getByTestId('project-row').filter({ hasText: `${name}-renamed` });
  await expect(renamed).toHaveCount(1);

  await renamed.getByRole('button', { name: `Options for ${name}-renamed` }).click();
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  const confirm = page.getByRole('button', { name: 'Delete project' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('delete');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0);
});

test('the projects table shows 12 per page with name, sources and created date', async ({ page, app }) => {
  const prefix = named('paged');
  for (let i = 1; i <= 13; i++) {
    await app.post('/api/projects', { name: `${prefix}-${String(i).padStart(2, '0')}` });
  }
  const { project } = await app.post('/api/projects', { name: `${prefix}-with-sources` });
  await app.post(`/api/projects/${project.id}/sources`, { name: 'api' });
  await app.post(`/api/projects/${project.id}/sources`, { name: 'worker' });

  await page.goto('/projects');
  // Finding is done in the browser: typing sends nothing to the server.
  const asked = [];
  page.on('request', (r) => r.url().includes('/api/projects') && asked.push(r.url()));
  await page.getByLabel('Find a project').fill(prefix);
  await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Sources', 'Created', '']);
  await expect(page.getByTestId('project-row')).toHaveCount(12);
  // Newest first: the project with sources is on page 1, with its two sources counted.
  const withSources = page.getByTestId('project-row').filter({ hasText: `${prefix}-with-sources` });
  await expect(withSources.locator('td').nth(1)).toHaveText('2');
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('project-row')).toHaveCount(2);
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByTestId('project-row')).toHaveCount(12);
  await page.getByLabel('Find a project').fill(`${prefix}-WITH`);
  await expect(page.getByTestId('project-row')).toHaveCount(1);
  await page.getByLabel('Find a project').fill(`${prefix}-nothing`);
  await expect(page.getByText('No projects match.')).toBeVisible();
  expect(asked).toEqual([]);
});

test('the project switcher list has a fixed height and scrolls; its actions stay in reach', async ({
  page,
  app,
}) => {
  const prefix = named('switch');
  for (let i = 1; i <= 10; i++)
    await app.post('/api/projects', { name: `${prefix}-${String(i).padStart(2, '0')}` });
  const { project } = await app.post('/api/projects', { name: `${prefix}-current` });
  await page.goto(`/dashboard?project=${project.id}`);
  await page.getByTestId('project-switcher').click();
  const list = page.getByTestId('project-list');
  const size = await list.evaluate((el) => ({ shown: el.clientHeight, all: el.scrollHeight }));
  expect(size.shown).toBeLessThanOrEqual(272);
  expect(size.all).toBeGreaterThan(size.shown);
  // The current project is scrolled into view, and the actions below the list are on screen.
  await expect(list.getByRole('menuitem', { name: `${prefix}-current` })).toBeInViewport();
  await expect(page.getByRole('menuitem', { name: 'New project' })).toBeInViewport();
  await expect(page.getByRole('menuitem', { name: 'All projects' })).toBeInViewport();
});
