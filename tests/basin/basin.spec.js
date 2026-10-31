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

// The chips are the one filter: the source picker, the level toggles and saved views all show and edit them.
test('live tail filters stay in sync: source picker, level toggles, chips and saved views', async ({
  page,
}) => {
  const { projectId } = seed();
  await page.goto(`/tail?project=${projectId}`);
  await expect(page.getByTestId('event')).toHaveCount(50);
  const chips = page.locator('.query .chip');
  const level = (/** @type {string} */ name) =>
    page.getByRole('group', { name: 'Show levels' }).getByRole('button', { name, exact: true });

  // Picking a source adds its chip; the address bar keeps it.
  await page.getByLabel('Source', { exact: true }).selectOption('api');
  await expect(chips).toHaveText(['source = api']);
  await expect(page.getByTestId('event')).toHaveCount(40);
  await expect(page).toHaveURL(/q=source%3Aapi/);

  // Turning a level off edits the level chip; turning it back on removes it.
  await level('info').click();
  await expect(level('info')).toHaveAttribute('aria-pressed', 'false');
  await expect(chips).toHaveText(['source = api', 'level = warn, error, fatal']);
  await expect(page.getByTestId('event')).toHaveCount(24);
  await level('info').click();
  await expect(chips).toHaveText(['source = api']);

  // A typed level chip shows on the toggles too.
  await page.getByLabel('Search events').fill('level:error');
  await page.getByLabel('Search events').press('Enter');
  await expect(level('info')).toHaveAttribute('aria-pressed', 'false');
  await expect(level('warn')).toHaveAttribute('aria-pressed', 'false');
  await expect(level('error')).toHaveAttribute('aria-pressed', 'true');

  // Save it, clear everything, then apply the view: every control comes back.
  await page.getByTestId('views-menu').click();
  await page.getByRole('menuitem', { name: 'Save current view…' }).click();
  await page.getByRole('dialog', { name: 'Save view' }).getByLabel('Name').fill(named('errors'));
  await page.getByRole('button', { name: 'Save view' }).click();
  while ((await chips.count()) > 0) await chips.first().getByRole('button').click();
  await expect(chips).toHaveCount(0);
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('');
  await expect(level('info')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('event')).toHaveCount(50);

  await page.getByTestId('views-menu').click();
  await page.getByRole('menuitem', { name: named('errors') }).click();
  await expect(chips).toHaveText(['source = api', 'level = error']);
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('api');
  await expect(level('info')).toHaveAttribute('aria-pressed', 'false');
  await expect(level('error')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('event')).toHaveCount(16);
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
