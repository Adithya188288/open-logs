import { describe, expect, it } from 'vitest';
import { api, createProjectWithSource, ingest, signInOwner } from '../helpers.js';

async function seeded() {
  const cookie = await signInOwner();
  const { project, token } = await createProjectWithSource(cookie);
  const now = Date.now();
  await ingest(token, [
    { ts: now - 50_000, level: 'info', message: 'GET /health 200', status: 200, duration_ms: 3 },
    { ts: now - 40_000, level: 'error', message: 'POST /checkout 500', status: 500, duration_ms: 900 },
    { ts: now - 30_000, level: 'warn', message: 'slow query', duration_ms: 1400 },
    { ts: now - 20_000, level: 'error', message: 'payment failed', code: 'card_declined' },
    { ts: now - 10_000, level: 'info', message: 'POST /checkout 200', status: 200, duration_ms: 180 },
  ]);
  const range = { project_id: project.id, from: now - 60_000, to: now + 1000 };
  return { cookie, project, token, range, now };
}

describe('query api', () => {
  it('signs in → creates project → creates source → ingests → queries it back', async () => {
    const { cookie, range } = await seeded();
    const all = await api('/api/query', { cookie, body: range });
    expect(all.json.events.map((e) => e.message)).toEqual([
      'POST /checkout 200',
      'payment failed',
      'slow query',
      'POST /checkout 500',
      'GET /health 200',
    ]);
    const errors = await api('/api/query', {
      cookie,
      body: { ...range, where: [{ field: 'level', op: '=', value: 'error' }, { text: 'checkout' }] },
    });
    expect(errors.json.events.map((e) => e.message)).toEqual(['POST /checkout 500']);
  });

  it('pages with limit and cursor', async () => {
    const { cookie, range } = await seeded();
    const first = await api('/api/query', { cookie, body: { ...range, limit: 3 } });
    expect(first.json.events).toHaveLength(3);
    const second = await api('/api/query', {
      cookie,
      body: { ...range, limit: 3, cursor: first.json.next_cursor },
    });
    expect(second.json.events).toHaveLength(2);
    expect(second.json.next_cursor).toBeNull();
  });

  it('validates the filter', async () => {
    const { cookie, range } = await seeded();
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

  it('returns a histogram by bucket and level', async () => {
    const { cookie, range } = await seeded();
    const h = await api('/api/histogram', { cookie, body: range });
    expect(h.status).toBe(200);
    expect(h.json.interval_ms).toBe(5000);
    expect(h.json.total).toBe(5);
    expect(h.json.errors).toBe(2);
    expect(h.json.buckets.reduce((n, b) => n + b.warn, 0)).toBe(1);
  });

  it('aggregates for charts', async () => {
    const { cookie, range } = await seeded();
    const count = await api('/api/aggregate', {
      cookie,
      body: { ...range, measure: 'count', field: 'level' },
    });
    expect(count.json.value).toBe(5);
    expect(count.json.groups).toEqual([
      { key: 'error', value: 2 },
      { key: 'info', value: 2 },
      { key: 'warn', value: 1 },
    ]);
    const p95 = await api('/api/aggregate', {
      cookie,
      body: { ...range, measure: 'p95', field: 'fields.duration_ms' },
    });
    expect(p95.json.value).toBe(1400);
    const avg = await api('/api/aggregate', {
      cookie,
      body: { ...range, measure: 'avg', field: 'fields.duration_ms' },
    });
    expect(avg.json.value).toBeCloseTo((3 + 900 + 1400 + 180) / 4);
    const bad = await api('/api/aggregate', { cookie, body: { ...range, measure: 'avg', field: 'level' } });
    expect(bad.status).toBe(400);
    const badMeasure = await api('/api/aggregate', { cookie, body: { ...range, measure: 'sum' } });
    expect(badMeasure.status).toBe(400);
  });

  it('computes only the requested parts of an aggregate', async () => {
    const { cookie, range } = await seeded();
    const only = await api('/api/aggregate', {
      cookie,
      body: { ...range, measure: 'count', field: 'level', parts: ['value'] },
    });
    expect(only.json).toMatchObject({ value: 5, groups: [], series: [], series_by_group: [] });
    const groups = await api('/api/aggregate', {
      cookie,
      body: { ...range, measure: 'count', field: 'level', parts: ['groups'] },
    });
    expect(groups.json.groups).toHaveLength(3);
    expect(groups.json.value).toBeNull();
    const bad = await api('/api/aggregate', {
      cookie,
      body: { ...range, measure: 'count', parts: ['everything'] },
    });
    expect(bad.status).toBe(400);
  });

  it('reports storage mode and freshness', async () => {
    const { cookie, project, now } = await seeded();
    const s = await api(`/api/status?project_id=${project.id}`, { cookie });
    expect(s.json).toMatchObject({ storage: 'local', lag_ms: 0 });
    expect(s.json.newest_event_at).toBe(now - 10_000);
  });

  it('includes 24h stats on the projects list', async () => {
    const { cookie, project } = await seeded();
    const list = await api('/api/projects', { cookie });
    const mine = list.json.projects.find((p) => p.id === project.id);
    expect(mine.stats).toMatchObject({ events_24h: 5, errors_24h: 2 });
    expect(mine.stats.spark).toHaveLength(24);
  });
});
