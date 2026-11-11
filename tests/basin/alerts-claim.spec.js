// Alert checks may overlap (a slow Basin can make one run longer than a minute), so each check claims an alert for
// its period and only acts while that claim is the latest. Here a newer check's claim is put in place directly in
// the install's D1; the minute checks must then leave the alert alone, and act again once the claim is released.
import { execFileSync } from 'node:child_process';
import { branchInstall, configPath } from '../../scripts/lib.js';
import { expect, named, RUN, TEST_WEBHOOK, test } from '../fixtures.js';

test.skip(!TEST_WEBHOOK, 'Set OPEN_LOGS_TEST_WEBHOOK to a request catcher URL');

const MINUTE = 60_000;
const install = process.env.OPEN_LOGS_INSTALL || branchInstall();

/** Sets an alert's claim (checked_until) in the install's D1. @param {string} alertId @param {number} until */
function setClaim(alertId, until) {
  if (!/^alr_[A-Za-z0-9]+$/.test(alertId)) throw new Error('unexpected alert id');
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--remote',
      '-c',
      configPath(install),
      '--command',
      `UPDATE alerts SET checked_until = ${Math.trunc(until)} WHERE id = '${alertId}'`,
    ],
    { stdio: 'pipe' },
  );
}

test('a check leaves an alert alone while a newer check holds its claim', async ({ page, app }) => {
  test.setTimeout(35 * MINUTE);
  const tag = `${RUN}-claim`;
  const { project } = await app.post('/api/projects', { name: named('claim') });
  const { token } = await app.post(`/api/projects/${project.id}/sources`, { name: 'svc' });
  const { dashboards } = await app.get(`/api/projects/${project.id}/dashboards`);
  const { chart } = await app.post(`/api/dashboards/${dashboards[0].id}/charts`, {
    title: 'claim',
    filter: {
      where: [
        { field: 'level', op: '=', value: 'error' },
        { field: 'fields.run', op: '=', value: tag },
      ],
    },
    measure: 'count',
    viz: 'number',
  });
  const settings = {
    name: 'claim',
    kind: 'above',
    threshold: 1,
    window_minutes: 15,
    quiet_minutes: 5,
    webhook_url: TEST_WEBHOOK,
  };
  const { alert } = await app.put(`/api/charts/${chart.id}/alert`, settings);
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
  const state = () => app.get(`/api/alerts/${alert.id}`);

  await sendErrors();
  let polls = 0;
  await expect
    .poll(
      async () => {
        if (++polls % 6 === 0) await sendErrors();
        return Boolean((await state()).open_incident);
      },
      { timeout: 20 * MINUTE, intervals: [30_000], message: 'an incident opens' },
    )
    .toBe(true);
  const open = (await state()).open_incident.id;

  // The condition stops holding, but a newer check (far-future period) holds the claim: nothing may change.
  await app.put(`/api/charts/${chart.id}/alert`, { ...settings, threshold: 1_000_000 });
  setClaim(alert.id, Date.now() + 24 * 60 * MINUTE);
  await page.waitForTimeout(2.5 * MINUTE);
  expect((await state()).open_incident?.id).toBe(open);

  // Released: the next check claims it and resolves the incident.
  setClaim(alert.id, 0);
  await expect
    .poll(async () => (await state()).resolved.incidents[0]?.resolved_by, {
      timeout: 4 * MINUTE,
      intervals: [15_000],
      message: 'the incident resolves once the claim is released',
    })
    .toBe('auto');
});
