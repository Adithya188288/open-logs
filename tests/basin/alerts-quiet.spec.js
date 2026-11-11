// Resolving by hand while the once-a-minute check is running must still start the quiet time. Each of four
// alerts with a 60-minute quiet time is resolved in the first seconds of a minute, while that minute's check
// runs; none may open a new incident. (Before the fix, all four reopened about 10 seconds later.)
import { expect, named, RUN, TEST_WEBHOOK, test } from '../fixtures.js';

test.skip(!TEST_WEBHOOK, 'Set OPEN_LOGS_TEST_WEBHOOK to a request catcher URL');

const MINUTE = 60_000;

test('resolving during a check still holds back new incidents for the quiet time', async ({ page, app }) => {
  test.setTimeout(30 * MINUTE);
  const tag = `${RUN}-quiet`;
  const { project } = await app.post('/api/projects', { name: named('quiet') });
  const { token } = await app.post(`/api/projects/${project.id}/sources`, { name: 'svc' });
  const { dashboards } = await app.get(`/api/projects/${project.id}/dashboards`);
  const alerts = [];
  for (let i = 0; i < 4; i++) {
    const { chart } = await app.post(`/api/dashboards/${dashboards[0].id}/charts`, {
      title: `quiet-${i}`,
      filter: {
        where: [
          { field: 'level', op: '=', value: 'error' },
          { field: 'fields.run', op: '=', value: tag },
        ],
      },
      measure: 'count',
      viz: 'number',
    });
    const { alert } = await app.put(`/api/charts/${chart.id}/alert`, {
      name: `quiet-${i}`,
      kind: 'above',
      threshold: 1,
      window_minutes: 15,
      quiet_minutes: 60,
      webhook_url: TEST_WEBHOOK,
    });
    alerts.push(alert);
  }
  const sendErrors = async () => {
    const now = Date.now();
    const data = Array.from({ length: 20 }, (_, i) => ({
      ts: now - i * 1000,
      level: 'error',
      message: 'boom',
      run: tag,
    }));
    expect(
      (await page.request.post('/v1/logs', { data, headers: { authorization: `Bearer ${token}` } })).status(),
    ).toBe(202);
  };
  const states = () => Promise.all(alerts.map((a) => app.get(`/api/alerts/${a.id}`)));

  await sendErrors();
  let polls = 0;
  await expect
    .poll(
      async () => {
        if (++polls % 6 === 0) await sendErrors();
        return (await states()).every((s) => s.open_incident);
      },
      { timeout: 20 * MINUTE, intervals: [30_000], message: 'all four incidents open' },
    )
    .toBe(true);

  const open = (await states()).map((s) => s.open_incident.id);
  const next = Math.ceil(Date.now() / MINUTE) * MINUTE;
  await Promise.all(
    open.map(async (id, i) => {
      await page.waitForTimeout(next + [400, 900, 1400, 2200][i] - Date.now());
      await app.post(`/api/incidents/${id}/resolve`);
    }),
  );
  // Two more checks run while the condition still holds; the quiet time must keep every alert closed.
  await page.waitForTimeout(2.5 * MINUTE);
  for (const s of await states()) {
    expect(s.open_incident, `${s.alert.name} opened a new incident during its quiet time`).toBeNull();
    expect(s.resolved.incidents[0].resolved_by).toBe('manual');
  }
});
