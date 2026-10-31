// Checks that need real logs in Basin. They run in order: the first one waits until this run's seeded logs
// are searchable (usually 1.5–3.5 minutes after seed.setup.js sent them); the rest read them.
import { expect, named, RUN, seed, test } from '../fixtures.js';

test.describe.configure({ mode: 'serial' });

const BASIN_WAIT_MS = 6 * 60_000;
const thisRun = [{ field: 'fields.run', op: '=', value: RUN }];

test('the seeded logs reach Basin and search returns exactly them', async ({ app }) => {
  test.setTimeout(BASIN_WAIT_MS + 60_000);
  const { projectId, sentAt } = seed();
  await expect
    .poll(async () => (await app.query(projectId, thisRun).catch(() => ({ events: [] }))).events.length, {
      timeout: BASIN_WAIT_MS,
      intervals: [10_000],
      message: 'all 50 seeded logs searchable in Basin',
    })
    .toBe(50);
  const seconds = Math.round((Date.now() - sentAt) / 1000);
  test.info().annotations.push({ type: 'Basin delay', description: `searchable ${seconds}s after sending` });

  const { events } = await app.query(projectId, thisRun);
  const count = (/** @type {string} */ level) => events.filter((e) => e.level === level).length;
  expect([count('info'), count('warn'), count('error')]).toEqual([20, 10, 20]);
  expect(events.filter((e) => e.source === 'api')).toHaveLength(40);
  expect(events.filter((e) => e.source === 'worker')).toHaveLength(10);
});

test('live tail shows the logs, and search narrows them', async ({ page }) => {
  const { projectId } = seed();
  await page.goto(`/tail?project=${projectId}`);
  await expect(page.getByTestId('event')).toHaveCount(50);
  await page.getByLabel('Search events').fill('level:error');
  await page.getByLabel('Search events').press('Enter');
  await expect(page.getByTestId('event')).toHaveCount(20);
  await page.getByLabel('Search events').fill('card_declined');
  await page.getByLabel('Search events').press('Enter');
  await expect(page.getByTestId('event')).toHaveCount(10);
});

test('reloading live tail shows the loader once, then the logs', async ({ page }) => {
  const { projectId } = seed();
  await page.goto(`/tail?project=${projectId}`);
  await expect(page.getByTestId('event')).toHaveCount(50);
  await page.reload();
  await expect(
    page.getByRole('status', { name: 'Loading' }).or(page.getByTestId('event').first()),
  ).toBeVisible();
  await expect(page.getByTestId('event')).toHaveCount(50);
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
});

test('the dashboard counts match what was sent', async ({ page }) => {
  const { projectId } = seed();
  await page.goto(`/dashboard?project=${projectId}`);
  const tile = (/** @type {string} */ title) =>
    page.getByTestId('chart').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(tile('Events').getByTestId('chart-value')).toHaveText('50');
  await expect(tile('Errors').getByTestId('chart-value')).toHaveText('20');
});

test('switching projects shows the other project, then back again', async ({ page, app }) => {
  const { projectId } = seed();
  const { project: empty } = await app.post('/api/projects', { name: named('empty') });
  await page.goto(`/dashboard?project=${projectId}`);
  await expect(page.getByTestId('chart').first().getByTestId('chart-value')).toHaveText('50');
  await page.getByTestId('project-switcher').click();
  await page.getByRole('menuitem', { name: named('empty') }).click();
  await expect(page).toHaveURL(new RegExp(`project=${empty.id}`));
  await expect(page.getByTestId('no-logs-yet')).toBeVisible();
  await page.getByTestId('project-switcher').click();
  await page.getByRole('menuitem', { name: named('logs') }).click();
  await expect(page.getByTestId('chart').first().getByTestId('chart-value')).toHaveText('50');
});

// Regression check for the source_id fix: logs belong to the source's id, not its name.
test('a renamed source keeps its logs; a new source with the old name starts empty', async ({
  page,
  app,
}) => {
  const { projectId, sources } = seed();
  await app.patch(`/api/sources/${sources.worker.id}`, { name: 'worker-renamed' });
  const byName = async (/** @type {string} */ name) =>
    (await app.query(projectId, [...thisRun, { field: 'source', op: '=', value: name }])).events;
  expect(await byName('worker-renamed')).toHaveLength(10);
  expect(await byName('worker')).toHaveLength(0);

  await app.post(`/api/projects/${projectId}/sources`, { name: 'worker' });
  expect(await byName('worker')).toHaveLength(0);
  expect(await byName('worker-renamed')).toHaveLength(10);

  await page.goto(`/tail?project=${projectId}`);
  await page.getByLabel('Search events').fill('source:worker-renamed');
  await page.getByLabel('Search events').press('Enter');
  await expect(page.getByTestId('event')).toHaveCount(10);
  await expect(page.getByTestId('event').first()).toContainText('worker-renamed');
});
