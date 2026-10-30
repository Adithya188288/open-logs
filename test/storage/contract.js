// Storage contract: the same behaviour is expected from every LogStorage adapter.
import { beforeEach, describe, expect, it } from 'vitest';
import { parseFilter } from '../../src/query/filter.js';

export const NOW = Date.UTC(2026, 9, 30, 10, 42, 0);

/** Fixed sample: 6 events over 6 minutes in prj_a, 1 event in prj_b. */
export function sampleEvents() {
  const at = (minAgo) => NOW - minAgo * 60_000;
  return [
    {
      id: 'e1',
      ts: at(6),
      project_id: 'prj_a',
      source: 'api',
      level: 'info',
      message: 'GET /health 200',
      fields: '{"status":200,"duration_ms":3}',
    },
    {
      id: 'e2',
      ts: at(5),
      project_id: 'prj_a',
      source: 'api',
      level: 'error',
      message: 'POST /checkout 500 upstream timeout',
      fields: '{"status":500,"duration_ms":10000,"route":"/checkout"}',
    },
    {
      id: 'e3',
      ts: at(4),
      project_id: 'prj_a',
      source: 'worker',
      level: 'error',
      message: 'payment failed: card_declined',
      fields: '{"order_id":4821,"code":"card_declined","http":{"status":402}}',
    },
    {
      id: 'e4',
      ts: at(3),
      project_id: 'prj_a',
      source: 'worker',
      level: 'warn',
      message: 'retrying job sync-inventory',
      fields: '{"attempt":2}',
    },
    {
      id: 'e5',
      ts: at(2),
      project_id: 'prj_a',
      source: 'api',
      level: 'info',
      message: 'POST /checkout 200 182ms',
      fields: '{"status":200,"duration_ms":182,"route":"/checkout"}',
    },
    {
      id: 'e6',
      ts: at(1),
      project_id: 'prj_a',
      source: 'web',
      level: 'info',
      message: 'GET /pricing 200 38ms',
      fields: '{"status":200,"duration_ms":38,"device":"mobile"}',
    },
    {
      id: 'b1',
      ts: at(1),
      project_id: 'prj_b',
      source: 'api',
      level: 'error',
      message: 'other project',
      fields: '{}',
    },
  ];
}

/**
 * @param {string} name
 * @param {() => Promise<import('../../src/storage/index.js').LogStorage>} makeStorage
 */
export function storageContract(name, makeStorage) {
  describe(`${name} storage contract`, () => {
    /** @type {import('../../src/storage/index.js').LogStorage} */
    let storage;
    const f = (where = [], extra = {}) =>
      parseFilter({ project_id: 'prj_a', from: NOW - 10 * 60_000, to: NOW, where, ...extra });
    const ids = (r) => r.events.map((e) => e.id);

    beforeEach(async () => {
      storage = await makeStorage();
      await storage.write(sampleEvents());
    });

    it('returns a project’s events newest first, never another project’s', async () => {
      const r = await storage.query(f());
      expect(ids(r)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2', 'e1']);
      expect(r.events[0]).toMatchObject({ source: 'web', level: 'info', fields: { device: 'mobile' } });
    });

    it('respects the time range', async () => {
      const r = await storage.query(f([], { from: NOW - 3.5 * 60_000, to: NOW - 1.5 * 60_000 }));
      expect(ids(r)).toEqual(['e5', 'e4']);
    });

    it('filters by level, source and JSON fields', async () => {
      expect(ids(await storage.query(f([{ field: 'level', op: 'in', value: ['error', 'warn'] }])))).toEqual([
        'e4',
        'e3',
        'e2',
      ]);
      expect(ids(await storage.query(f([{ field: 'source', op: '!=', value: 'api' }])))).toEqual([
        'e6',
        'e4',
        'e3',
      ]);
      expect(ids(await storage.query(f([{ field: 'fields.status', op: '=', value: 500 }])))).toEqual(['e2']);
      expect(ids(await storage.query(f([{ field: 'fields.status', op: '=', value: '500' }])))).toEqual([
        'e2',
      ]);
      expect(ids(await storage.query(f([{ field: 'fields.duration_ms', op: '>', value: 100 }])))).toEqual([
        'e5',
        'e2',
      ]);
      expect(ids(await storage.query(f([{ field: 'fields.http.status', op: '=', value: 402 }])))).toEqual([
        'e3',
      ]);
      expect(ids(await storage.query(f([{ field: 'fields.code', op: 'exists' }])))).toEqual(['e3']);
      expect(
        ids(await storage.query(f([{ field: 'fields.route', op: 'contains', value: 'check' }]))),
      ).toEqual(['e5', 'e2']);
    });

    it('searches free text in the message and fields, case-insensitively', async () => {
      expect(ids(await storage.query(f([{ text: 'CHECKOUT' }])))).toEqual(['e5', 'e2']);
      expect(ids(await storage.query(f([{ text: 'card_declined' }])))).toEqual(['e3']);
      expect(ids(await storage.query(f([{ text: '100%_' }])))).toEqual([]);
    });

    it('pages with a cursor', async () => {
      const first = await storage.query(f([], { limit: 4 }));
      expect(ids(first)).toEqual(['e6', 'e5', 'e4', 'e3']);
      expect(first.next_cursor).toBeTruthy();
      const second = await storage.query(f([], { limit: 4, cursor: first.next_cursor }));
      expect(ids(second)).toEqual(['e2', 'e1']);
      expect(second.next_cursor).toBeNull();
    });

    it('counts events per bucket and level', async () => {
      const h = await storage.histogram(f(), 5 * 60_000);
      const total = h.buckets.reduce((n, b) => n + b.info + b.warn + b.error + b.debug + b.fatal, 0);
      expect(total).toBe(6);
      expect(h.interval_ms).toBe(300_000);
      expect(h.buckets.reduce((n, b) => n + b.error, 0)).toBe(2);
    });

    it('aggregates counts by field, averages and p95 over time', async () => {
      const byLevel = await storage.aggregate(f(), { measure: 'count', field: 'level', interval: 60_000 });
      expect(byLevel.value).toBe(6);
      expect(byLevel.groups[0]).toEqual({ key: 'info', value: 3 });
      expect(byLevel.series.reduce((n, p) => n + p.value, 0)).toBe(6);

      const avg = await storage.aggregate(f(), {
        measure: 'avg',
        field: 'fields.duration_ms',
        group_by: 'source',
        interval: 60_000,
      });
      expect(avg.value).toBeCloseTo((3 + 10000 + 182 + 38) / 4);
      expect(avg.groups.find((g) => g.key === 'web').value).toBe(38);

      const p95 = await storage.aggregate(f(), {
        measure: 'p95',
        field: 'fields.duration_ms',
        group_by: 'source',
        interval: 60_000,
      });
      expect(p95.value).toBe(10000);
      expect(p95.groups.find((g) => g.key === 'api').value).toBe(10000);
    });

    it('reports the newest event time for a project', async () => {
      expect(await storage.newest('prj_a')).toBe(NOW - 60_000);
      expect(await storage.newest('prj_none')).toBeNull();
    });

    it('summarises several projects at once', async () => {
      const o = await storage.overview(['prj_a', 'prj_b'], NOW - 10 * 60_000, NOW, 60_000);
      expect(o.prj_a.total).toBe(6);
      expect(o.prj_a.errors).toBe(2);
      expect(o.prj_b.total).toBe(1);
    });
  });
}
