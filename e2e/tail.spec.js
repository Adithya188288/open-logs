import { expect, sampleEvents, test, uniq } from './fixtures.js';

async function seeded(app, n = 40) {
  const ctx = await app.projectWithSource(uniq('tail'), 'api');
  await app.send(ctx.token, sampleEvents(Date.now(), n));
  return ctx;
}

test('search, field:value chips, time range and honest freshness', async ({ page, app }) => {
  const { project } = await seeded(app);
  await page.goto(`/tail?project=${project.id}`);
  await expect(page.getByTestId('event')).toHaveCount(40);
  await expect(page.getByTestId('summary')).toContainText('40 events · 15 min · 16 errors');
  // The rows must actually be on screen, not clipped by a collapsed container (seen at small window sizes).
  await page.setViewportSize({ width: 800, height: 622 });
  await expect
    .poll(async () => (await page.locator('.tail-body').boundingBox())?.height ?? 0)
    .toBeGreaterThan(300);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId('freshness')).toContainText(
    /Data through \d\d:\d\d:\d\d UTC · next check \ds/,
  );

  await page.getByLabel('Search events').fill('level:error checkout');
  await page.getByLabel('Search events').press('Enter');
  await expect(page.locator('.chip')).toHaveText(['level = error']);
  await expect(page.getByTestId('event')).toHaveCount(8);
  await expect(page.getByTestId('event').first()).toContainText('POST /checkout 500');

  await page.getByRole('button', { name: 'Remove filter level = error' }).click();
  await expect(page.getByTestId('event')).toHaveCount(16);

  await page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: '1h' }).click();
  await expect(page.getByTestId('summary')).toContainText('· 1 h ·');
});

test('histogram: click a bar to zoom, legend toggles a level', async ({ page, app }) => {
  const { project } = await seeded(app);
  await page.goto(`/tail?project=${project.id}`);
  await expect(page.getByTestId('event')).toHaveCount(40);

  const info = page.getByRole('group', { name: 'Show levels' }).getByRole('button', { name: 'info' });
  await info.click();
  await expect(info).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('event')).toHaveCount(24);
  await expect(page.getByTestId('event').filter({ hasText: 'INFO' })).toHaveCount(0);
  await info.click();

  const bar = page.getByTestId('histogram').locator('.bar:not(.empty)').last();
  await bar.click();
  await expect(page.getByRole('button', { name: 'Back to now' })).toBeVisible();
  await expect(page.getByTestId('summary')).toContainText('15 s');
  const zoomed = await page.getByTestId('event').count();
  expect(zoomed).toBeGreaterThan(0);
  expect(zoomed).toBeLessThan(40);
  await page.getByRole('button', { name: 'Back to now' }).click();
  await expect(page.getByTestId('event')).toHaveCount(40);
});

test('details open in a side panel with Filter and Chart per field; keyboard j/k/Enter and /', async ({
  page,
  app,
}) => {
  const { project } = await seeded(app);
  await page.goto(`/tail?project=${project.id}`);
  const events = page.getByTestId('event');
  await expect(events).toHaveCount(40);

  const list = page.getByLabel(/^Event list/);
  await list.focus();
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await expect(events.nth(1)).toHaveClass(/cursor/);
  await page.keyboard.press('Enter');
  await expect(events.nth(1)).toHaveClass(/open/);
  const panel = page.getByRole('complementary', { name: 'Event details' });
  await expect(panel.locator('.f')).toContainText(['timestamp', 'source', 'level']);
  await expect(panel.getByRole('button', { name: 'View events around this' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy link to event' })).toBeVisible();

  await page.keyboard.press('j');
  await expect(events.nth(2)).toHaveClass(/open/);
  const level = panel.locator('.f').filter({ hasText: /^level/ });
  const levelValue = await level.locator('.v').textContent();
  await level.getByRole('button', { name: '= Filter' }).click();
  await expect(page.locator('.chip')).toHaveText([`level = ${levelValue}`]);
  await expect(panel).toBeHidden();

  await page.locator('body').click({ position: { x: 600, y: 10 } });
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search events')).toBeFocused();
});

test('pause freezes the tail; otherwise rows keep streaming, even with the panel open; wrap lines toggles', async ({
  page,
  app,
}) => {
  const { project, token } = await seeded(app, 10);
  await page.goto(`/tail?project=${project.id}`);
  await expect(page.getByTestId('event')).toHaveCount(10);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByTestId('freshness')).toContainText('Paused · frozen at data through');
  await app.send(token, { level: 'info', message: 'arrived while paused' });
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('event')).toHaveCount(10);

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('event').first()).toContainText('arrived while paused');

  await page.getByTestId('event').nth(2).locator('.row').click();
  await expect(page.getByRole('complementary', { name: 'Event details' })).toBeVisible();
  await app.send(token, { level: 'warn', message: 'arrived while reading' });
  await expect(page.getByTestId('event').first()).toContainText('arrived while reading', { timeout: 8000 });
  await expect(page.getByRole('complementary', { name: 'Event details' })).toBeVisible();

  const wrap = page.getByRole('button', { name: 'Wrap lines' });
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.list')).toHaveClass(/wrap/);
});

test('states: loading, no results, query too large, waiting', async ({ page, app }) => {
  const { project } = await seeded(app);

  await page.route('**/api/query', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    // The route may have been removed while this request waited.
    await route.continue().catch(() => {});
  });
  await page.goto(`/tail?project=${project.id}`);
  // Live tail's first rows come with the single start-up load, so that's the loader you see.
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
  await page.unroute('**/api/query');
  await expect(page.getByTestId('event')).toHaveCount(40);

  await page.getByLabel('Search events').fill('status:503');
  await page.getByLabel('Search events').press('Enter');
  await expect(page.getByTestId('no-results')).toContainText('No events match status:503 in the last 15 min');
  await expect(page.getByTestId('no-results')).toContainText('40 events came in during that time');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByTestId('event')).toHaveCount(40);

  await page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: '7d' }).click();
  await page.getByLabel('Search events').fill('timeout');
  await page.getByLabel('Search events').press('Enter');
  await expect(page.getByTestId('too-large')).toContainText('This search would scan too much data');
  await page.getByRole('button', { name: 'Add level:error' }).click();
  await expect(page.getByTestId('event').first()).toContainText('timeout');

  const empty = await app.projectWithSource(uniq('empty'));
  await page.goto(`/tail?project=${empty.project.id}`);
  await expect(page.getByTestId('waiting')).toContainText('Waiting for the first event');
});

test('ingestion problem: a regenerated token shows rejected requests', async ({ page, app }) => {
  const { project, source, token } = await seeded(app, 5);
  await app.post(`/api/sources/${source.id}/regenerate`);
  for (let i = 0; i < 3; i++) {
    await page.request.post('/v1/logs', {
      data: { message: 'old token' },
      headers: { authorization: `Bearer ${token}` },
    });
  }
  await page.goto(`/tail?project=${project.id}`);
  const problem = page.getByTestId('ingestion-problem');
  await expect(problem).toContainText('No events from api for');
  await expect(problem).toContainText('The last 3 requests from this source');
  await expect(problem).toContainText('401 invalid token');
  await expect(page.getByRole('link', { name: 'Check source token' })).toHaveAttribute(
    'href',
    /\/sources\?project=/,
  );
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(problem).toHaveCount(0);
});

test('saved views live in the Views menu, re-apply their filter, and delete with DELETE', async ({
  page,
  app,
}) => {
  const { project } = await seeded(app);
  await page.goto(`/tail?project=${project.id}`);
  await page.getByLabel('Search events').fill('level:warn');
  await page.getByLabel('Search events').press('Enter');
  await expect(page.getByTestId('event')).toHaveCount(8);
  await page.getByTestId('views-menu').click();
  await page.getByRole('menuitem', { name: 'Save current view…' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Warnings');
  await page.getByRole('button', { name: 'Save view' }).click();

  await page.getByRole('button', { name: 'Remove filter level = warn' }).click();
  await expect(page.getByTestId('event')).toHaveCount(40);
  await page.getByTestId('views-menu').click();
  await page.getByTestId('saved-view').filter({ hasText: 'Warnings' }).click();
  await expect(page.getByTestId('event')).toHaveCount(8);

  await page.getByTestId('views-menu').click();
  await page.getByRole('button', { name: 'Delete view Warnings' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete view' }).click();
  await page.getByTestId('views-menu').click();
  await expect(page.getByTestId('saved-view')).toHaveCount(0);
});

test('export CSV downloads the visible events', async ({ page, app }) => {
  const { project } = await seeded(app, 5);
  await page.goto(`/tail?project=${project.id}`);
  await expect(page.getByTestId('event')).toHaveCount(5);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csv = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(csv).toString();
  expect(text.split('\r\n')).toHaveLength(6);
  expect(text).toContain('"time_utc","level","source","message","fields"');
});

test('source picker filters to one source; search help explains the syntax', async ({ page, app }) => {
  const { project, token } = await app.projectWithSource(uniq('pick'), 'api');
  const { token: workerToken } = await app.post(`/api/projects/${project.id}/sources`, { name: 'worker' });
  await app.send(token, sampleEvents(Date.now(), 6));
  await app.send(workerToken, [{ message: 'from worker', level: 'warn' }]);
  await page.goto(`/tail?project=${project.id}`);
  await expect(page.getByTestId('event')).toHaveCount(7);
  await page.getByLabel('Source', { exact: true }).selectOption('worker');
  await expect(page.getByTestId('event')).toHaveCount(1);
  await expect(page).toHaveURL(/source=worker/);
  await page.getByRole('button', { name: 'Search help' }).click();
  await expect(page.getByTestId('search-help')).toContainText('status:>=500');
});

test('the time column shows the date for ranges longer than a day', async ({ page, app }) => {
  const { project } = await seeded(app, 10);
  await page.goto(`/tail?project=${project.id}`);
  const firstTime = page.getByTestId('event').first().locator('.t');
  await expect(firstTime).toHaveText(/^\d\d:\d\d:\d\d\.\d{3}$/);
  await page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: '7d' }).click();
  await expect(firstTime).toHaveText(/^[A-Z][a-z]{2} \d{1,2} \d\d:\d\d:\d\d\.\d{3}$/);
});
