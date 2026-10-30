import { expect, sampleEvents, test, uniq } from './fixtures.js';

test('projects list shows live and waiting projects with the team table', async ({ page, app }) => {
  const liveName = uniq('live');
  const idleName = uniq('idle');
  const { token } = await app.projectWithSource(liveName);
  await app.post('/api/projects', { name: idleName });
  await app.send(token, sampleEvents());

  await page.goto('/');
  const live = page.getByTestId('project-card').filter({ hasText: liveName });
  await expect(live).toContainText('Live');
  await expect(live).toContainText('40 events · 24h');
  await expect(live).toContainText('16 errors');
  await expect(live.locator('.tag')).toHaveText(['api']);

  const idle = page.getByTestId('project-card').filter({ hasText: idleName });
  await expect(idle).toContainText('Waiting for data');
  await expect(idle.getByRole('link', { name: 'Connect a source' })).toBeVisible();

  await page.getByLabel('Find a project').fill(idleName);
  await expect(page.getByTestId('project-card')).toHaveCount(1);

  const team = page.locator('#team');
  await expect(team.getByRole('heading', { name: 'Team' })).toBeVisible();
  await expect(team.getByRole('row').filter({ hasText: 'owner@e2e.test' })).toContainText('Owner');
});

test('creates a project from the New project dialog', async ({ page }) => {
  const name = uniq('new');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/connect\?project=prj_/);
  await expect(page.getByText(`${name} · new project`)).toBeVisible();
});
