import { describe, expect, it } from 'vitest';
import { api, createProjectWithSource, ingest, signInOwner } from '../helpers.js';

async function setup() {
  const cookie = await signInOwner();
  const { project, token } = await createProjectWithSource(cookie);
  return { cookie, project, token };
}

describe('saved views', () => {
  it('saves, lists and deletes a view', async () => {
    const { cookie, project } = await setup();
    const filter = { where: [{ field: 'level', op: 'in', value: ['error', 'fatal'] }], range: '1h' };
    const created = await api(`/api/projects/${project.id}/views`, {
      cookie,
      body: { name: 'Errors only', filter },
    });
    expect(created.status).toBe(201);
    const list = await api(`/api/projects/${project.id}/views`, { cookie });
    expect(list.json.views).toHaveLength(1);
    expect(list.json.views[0].filter).toEqual(filter);
    expect((await api(`/api/views/${created.json.view.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await api(`/api/projects/${project.id}/views`, { cookie })).json.views).toEqual([]);
  });

  it('rejects invalid view filters', async () => {
    const { cookie, project } = await setup();
    const bad = await api(`/api/projects/${project.id}/views`, {
      cookie,
      body: { name: 'x', filter: { where: [{ field: 'drop table', op: '=', value: 1 }] } },
    });
    expect(bad.status).toBe(400);
  });
});

describe('dashboards and charts', () => {
  it('gives every new project an Overview dashboard with starter charts', async () => {
    const { cookie, project } = await setup();
    const list = await api(`/api/projects/${project.id}/dashboards`, { cookie });
    expect(list.json.dashboards.map((d) => d.name)).toEqual(['Overview']);
    const one = await api(`/api/dashboards/${list.json.dashboards[0].id}`, { cookie });
    expect(one.json.charts.length).toBeGreaterThanOrEqual(4);
  });

  it('brings back one Overview with its starter charts when the last dashboard is deleted', async () => {
    const { cookie, project } = await setup();
    const list = await api(`/api/projects/${project.id}/dashboards`, { cookie });
    await api(`/api/dashboards/${list.json.dashboards[0].id}`, { method: 'DELETE', cookie });
    const [a, b] = await Promise.all([
      api(`/api/projects/${project.id}/dashboards`, { cookie }),
      api(`/api/projects/${project.id}/dashboards`, { cookie }),
    ]);
    expect(a.json.dashboards.map((d) => d.name)).toEqual(['Overview']);
    expect(b.json.dashboards.map((d) => d.id)).toEqual(a.json.dashboards.map((d) => d.id));
    const one = await api(`/api/dashboards/${a.json.dashboards[0].id}`, { cookie });
    expect(one.json.charts.length).toBeGreaterThanOrEqual(4);
  });

  it('creates, renames and deletes dashboards', async () => {
    const { cookie, project } = await setup();
    const d = await api(`/api/projects/${project.id}/dashboards`, { cookie, body: { name: 'Payments' } });
    expect(d.status).toBe(201);
    const renamed = await api(`/api/dashboards/${d.json.dashboard.id}`, {
      method: 'PATCH',
      cookie,
      body: { name: 'Pay' },
    });
    expect(renamed.json.dashboard.name).toBe('Pay');
    expect((await api(`/api/dashboards/${d.json.dashboard.id}`, { method: 'DELETE', cookie })).status).toBe(
      200,
    );
    expect((await api(`/api/dashboards/${d.json.dashboard.id}`, { cookie })).status).toBe(404);
  });

  it('pins a chart, then edits, duplicates and removes it', async () => {
    const { cookie, project } = await setup();
    const d = await api(`/api/projects/${project.id}/dashboards`, { cookie, body: { name: 'Payments' } });
    const id = d.json.dashboard.id;
    const chart = {
      title: 'Payment errors by code',
      filter: { where: [{ field: 'level', op: '=', value: 'error' }] },
      field: 'fields.code',
      measure: 'count',
      viz: 'bar',
    };
    const pinned = await api(`/api/dashboards/${id}/charts`, { cookie, body: chart });
    expect(pinned.status).toBe(201);
    const chartId = pinned.json.chart.id;

    const edited = await api(`/api/charts/${chartId}`, {
      method: 'PATCH',
      cookie,
      body: { viz: 'pie', title: 'By code' },
    });
    expect(edited.json.chart).toMatchObject({ viz: 'pie', title: 'By code', field: 'fields.code' });

    const dup = await api(`/api/charts/${chartId}/duplicate`, { method: 'POST', cookie });
    expect(dup.status).toBe(201);
    expect(dup.json.chart.title).toBe('By code (copy)');

    const after = await api(`/api/dashboards/${id}`, { cookie });
    expect(after.json.charts.map((c) => c.title)).toEqual(['By code', 'By code (copy)']);
    expect(after.json.charts[0].filter).toEqual(chart.filter);

    expect((await api(`/api/charts/${chartId}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await api(`/api/dashboards/${id}`, { cookie })).json.charts).toHaveLength(1);
  });

  it('validates charts', async () => {
    const { cookie, project } = await setup();
    const d = await api(`/api/projects/${project.id}/dashboards`, { cookie, body: { name: 'X' } });
    const url = `/api/dashboards/${d.json.dashboard.id}/charts`;
    const base = { title: 't', filter: { where: [] }, measure: 'count', viz: 'bar' };
    expect((await api(url, { cookie, body: { ...base, viz: 'radar' } })).status).toBe(400);
    expect((await api(url, { cookie, body: { ...base, measure: 'p95', field: 'level' } })).status).toBe(400);
    expect((await api(url, { cookie, body: { ...base, field: 'bad field' } })).status).toBe(400);
  });

  it('a pinned chart’s numbers match the query API', async () => {
    const { cookie, project, token } = await setup();
    const now = Date.now();
    await ingest(token, [
      { ts: now - 3000, level: 'error', message: 'payment failed', code: 'card_declined' },
      { ts: now - 2000, level: 'error', message: 'payment failed', code: 'card_declined' },
      { ts: now - 1000, level: 'error', message: 'payment failed', code: 'insufficient_funds' },
      { ts: now - 500, level: 'info', message: 'ok' },
    ]);
    const where = [{ field: 'level', op: '=', value: 'error' }];
    const range = { project_id: project.id, from: now - 60_000, to: now + 1000 };
    const agg = await api('/api/aggregate', {
      cookie,
      body: { ...range, where, measure: 'count', field: 'fields.code' },
    });
    expect(agg.json.groups).toEqual([
      { key: 'card_declined', value: 2 },
      { key: 'insufficient_funds', value: 1 },
    ]);
    const q = await api('/api/query', { cookie, body: { ...range, where } });
    expect(agg.json.value).toBe(q.json.events.length);
    expect(agg.json.series_by_group.map((g) => g.key)).toEqual(['card_declined', 'insufficient_funds']);
    const total = agg.json.series_by_group[0].series.reduce((n, p) => n + p.value, 0);
    expect(total).toBe(2);
  });
});
