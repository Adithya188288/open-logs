import { describe, expect, it } from 'vitest';
import { api, createProjectWithSource, signInOwner } from '../helpers.js';

// Search results, histograms and chart numbers come from Basin, so they are checked against real Basin in
// e2e/ (npm run test:e2e). Here: every request is validated before anything is sent to Basin.
async function setup() {
  const cookie = await signInOwner();
  const { project } = await createProjectWithSource(cookie);
  const now = Date.now();
  return { cookie, range: { project_id: project.id, from: now - 60_000, to: now + 1000 } };
}

describe('query api', () => {
  it('validates the filter', async () => {
    const { cookie, range } = await setup();
    expect((await api('/api/query', { cookie, body: { project_id: range.project_id } })).status).toBe(400);
    expect((await api('/api/query', { cookie, body: { ...range, project_id: 'prj_missing' } })).status).toBe(
      404,
    );
    const sqlish = await api('/api/query', {
      cookie,
      body: { ...range, where: [{ field: '1=1; --', op: '=', value: 1 }] },
    });
    expect(sqlish.status).toBe(400);
    const wide = await api('/api/query', {
      cookie,
      body: { ...range, from: range.to - 7 * 86_400_000, where: [{ text: 'timeout' }] },
    });
    expect(wide.status).toBe(422);
    expect(wide.json.error.code).toBe('query_too_large');
  });

  it('validates chart requests', async () => {
    const { cookie, range } = await setup();
    const aggregate = (body) => api('/api/aggregate', { cookie, body: { ...range, ...body } });
    expect((await aggregate({ measure: 'avg', field: 'level' })).status).toBe(400);
    expect((await aggregate({ measure: 'sum' })).status).toBe(400);
    expect((await aggregate({ measure: 'count', parts: ['everything'] })).status).toBe(400);
  });

  it('still lists projects when Basin cannot be reached, with empty counts', async () => {
    const { cookie } = await setup();
    const { status, json } = await api('/api/projects', { cookie });
    expect(status).toBe(200);
    expect(json.projects[0].stats).toEqual({ events_24h: 0, errors_24h: 0, spark: new Array(24).fill(0) });
  });
});
