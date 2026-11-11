// A real alert on real logs: the once-a-minute check opens an incident, keeps only one open, resolves it
// automatically, holds back a new one during the quiet time, opens again after it, and resolving by hand works.
// Slow on purpose: each check looks at logs that ended 5 minutes ago, and a new cron can take minutes to start.
import { expect, named, RUN, TEST_WEBHOOK, test, webhookBodies } from '../fixtures.js';

test.skip(!TEST_WEBHOOK, 'Set OPEN_LOGS_TEST_WEBHOOK to a request catcher URL');

const MINUTE = 60_000;

test('an alert opens, holds and resolves incidents on real logs', async ({ page, app }) => {
  test.setTimeout(45 * MINUTE);
  const { project } = await app.post('/api/projects', { name: named('alerting') });
  const { token } = await app.post(`/api/projects/${project.id}/sources`, { name: 'svc' });
  const { dashboards } = await app.get(`/api/projects/${project.id}/dashboards`);
  const { chart } = await app.post(`/api/dashboards/${dashboards[0].id}/charts`, {
    title: 'Alert errors',
    filter: {
      where: [
        { field: 'level', op: '=', value: 'error' },
        { field: 'fields.run', op: '=', value: RUN },
      ],
    },
    measure: 'count',
    viz: 'number',
  });
  const settings = {
    name: 'Errors spike',
    kind: 'above',
    threshold: 5,
    window_minutes: 15,
    quiet_minutes: 5,
    webhook_url: TEST_WEBHOOK,
  };
  const { alert } = await app.put(`/api/charts/${chart.id}/alert`, settings);
  const sendErrors = async () => {
    const now = Date.now();
    const events = Array.from({ length: 20 }, (_, i) => ({
      ts: now - i * 1000,
      level: 'error',
      message: 'POST /checkout 500 upstream timeout',
      run: RUN,
    }));
    const res = await page.request.post('/v1/logs', {
      data: events,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(202);
  };
  const state = async () => app.get(`/api/alerts/${alert.id}`);

  // 1. An incident opens. Errors are re-sent every 3 minutes in case the new cron takes a while to start.
  await sendErrors();
  let polls = 0;
  await expect
    .poll(
      async () => {
        if (++polls % 6 === 0) await sendErrors();
        return Boolean((await state()).open_incident);
      },
      { timeout: 25 * MINUTE, intervals: [30_000], message: 'an incident opens' },
    )
    .toBe(true);
  const first = (await state()).open_incident;
  test
    .info()
    .annotations.push({ type: 'Incident opened', description: new Date(first.started_at).toISOString() });
  await expect
    .poll(async () => (await state()).open_incident?.opened_webhook, { timeout: MINUTE })
    .toBe('200');

  await page.goto(`/dashboard?project=${project.id}`);
  await expect(page.getByTestId('chart-alert')).toHaveText('Open');

  // 2. While it's open, more checks don't open another one.
  await page.waitForTimeout(2 * MINUTE + 10_000);
  const held = await state();
  expect(held.open_incident?.id).toBe(first.id);
  expect(held.resolved.total).toBe(0);

  // 3. It resolves on its own once the condition no longer holds.
  await app.put(`/api/charts/${chart.id}/alert`, { ...settings, threshold: 1_000_000 });
  await expect
    .poll(async () => (await state()).resolved.incidents[0]?.resolved_by, {
      timeout: 4 * MINUTE,
      intervals: [15_000],
      message: 'the incident resolves automatically',
    })
    .toBe('auto');
  await expect
    .poll(async () => (await state()).resolved.incidents[0]?.resolved_webhook, { timeout: MINUTE })
    .toBe('200');

  // The webhooks are one flat object each: opened, then resolved, for this incident.
  const bodies = await webhookBodies(page.request);
  if (bodies) {
    const sent = bodies.filter((b) => b?.incident_id === first.id);
    const resolvedBody = sent.find((b) => b.type === 'incident.resolved');
    const openedBody = sent.find((b) => b.type === 'incident.opened');
    expect(Object.keys(resolvedBody).sort()).toEqual(
      [
        'type',
        'incident_id',
        'alert_id',
        'alert_name',
        'condition',
        'chart_id',
        'chart_title',
        'filter',
        'project_id',
        'project_name',
        'value',
        'started_at',
        'resolved_at',
        'resolved_by',
        'duration_seconds',
        'url',
      ].sort(),
    );
    expect(resolvedBody).toMatchObject({
      alert_id: alert.id,
      chart_id: chart.id,
      condition: 'Logs above 1000000 in the last 15 min',
      filter: `level:error run:${RUN}`,
      resolved_by: 'auto',
    });
    expect(resolvedBody.duration_seconds).toBeGreaterThan(60);
    expect(openedBody).toMatchObject({ resolved_at: null, resolved_by: null, duration_seconds: 0 });
  }

  // 4. The condition holds again, but nothing opens during the 5-minute quiet time.
  await app.put(`/api/charts/${chart.id}/alert`, settings);
  await sendErrors();
  await page.goto(`/alert?project=${project.id}&id=${alert.id}`);
  await expect(page.getByTestId('no-open-incident')).toContainText('A new incident can open after');
  await page.waitForTimeout(2 * MINUTE + 10_000);
  expect((await state()).open_incident).toBeNull();

  // 5. After the quiet time, a new incident opens.
  await expect
    .poll(async () => (await state()).open_incident?.id ?? null, {
      timeout: 8 * MINUTE,
      intervals: [15_000],
      message: 'a new incident opens after the quiet time',
    })
    .not.toBeNull();

  // 6. Resolving by hand.
  await page.reload();
  await expect(page.getByTestId('open-incident')).toBeVisible();
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByTestId('open-incident')).toHaveCount(0);
  await expect(page.getByTestId('resolved-incident').first()).toContainText('Resolved by hand');
  const after = await state();
  expect(after.resolved.total).toBe(2);
  expect(after.resolved.incidents[0].resolved_by).toBe('manual');
  await expect
    .poll(async () => (await state()).resolved.incidents[0]?.resolved_webhook, { timeout: MINUTE })
    .toBe('200');
});
