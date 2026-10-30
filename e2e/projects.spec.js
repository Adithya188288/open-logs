import { expect, sampleEvents, test, uniq } from './fixtures.js';

test('switcher under the logo lists projects and creates a new one', async ({ page }) => {
  const name = uniq('new');
  await page.goto('/');
  await page.getByTestId('project-switcher').click();
  await expect(page.getByRole('menuitem', { name: 'Default' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/sources\?project=prj_/);
  await expect(page.getByTestId('project-switcher')).toHaveText(new RegExp(name));
  await expect(page.getByTestId('no-sources')).toContainText('Add your first source');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByTestId('no-logs-yet')).toContainText('No logs yet');
});

test('All projects shows live and waiting projects; delete needs DELETE', async ({ page, app }) => {
  const liveName = uniq('live');
  const idleName = uniq('idle');
  const { token } = await app.projectWithSource(liveName);
  await app.post('/api/projects', { name: idleName });
  await app.send(token, sampleEvents());

  await page.goto('/projects');
  const live = page.getByTestId('project-card').filter({ hasText: liveName });
  await expect(live).toContainText('Live');
  await expect(live).toContainText('40 events · 24h');
  await expect(live).toContainText('16 errors');
  const idle = page.getByTestId('project-card').filter({ hasText: idleName });
  await expect(idle).toContainText('Waiting for data');

  await idle.getByRole('button', { name: `Options for ${idleName}` }).click();
  await page.getByRole('menuitem', { name: 'Delete project' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByTestId('project-card').filter({ hasText: idleName })).toHaveCount(0);
});
