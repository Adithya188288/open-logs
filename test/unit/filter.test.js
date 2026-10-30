import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, parseFilter, pickInterval } from '../../src/query/filter.js';

const NOW = 1_793_356_800_000;
const base = { project_id: 'prj_a', from: NOW - 15 * 60_000, to: NOW };

function err(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected an error');
}

describe('parseFilter', () => {
  it('accepts a structured filter and applies defaults', () => {
    const f = parseFilter({
      ...base,
      where: [{ field: 'level', op: 'in', value: ['error', 'warn'] }, { text: 'boom' }],
    });
    expect(f.limit).toBe(100);
    expect(f.where).toHaveLength(2);
  });

  it('requires a time range', () => {
    expect(err(() => parseFilter({ project_id: 'prj_a' })).status).toBe(400);
    expect(err(() => parseFilter({ ...base, from: NOW, to: NOW - 1 })).status).toBe(400);
  });

  it('caps the time range at 7 days and the limit at 500', () => {
    expect(err(() => parseFilter({ ...base, from: NOW - 8 * 86_400_000 })).status).toBe(400);
    expect(parseFilter({ ...base, limit: 10_000 }).limit).toBe(500);
  });

  it('rejects unknown columns, bad field keys and bad operators', () => {
    expect(
      err(() => parseFilter({ ...base, where: [{ field: 'project_id', op: '=', value: 'x' }] })).status,
    ).toBe(400);
    expect(
      err(() => parseFilter({ ...base, where: [{ field: 'fields.a;drop', op: '=', value: 1 }] })).status,
    ).toBe(400);
    expect(
      err(() => parseFilter({ ...base, where: [{ field: "fields.a')", op: '=', value: 1 }] })).status,
    ).toBe(400);
    expect(
      err(() => parseFilter({ ...base, where: [{ field: 'level', op: 'LIKE', value: 'x' }] })).status,
    ).toBe(400);
    expect(
      err(() => parseFilter({ ...base, where: [{ field: 'fields.n', op: '>', value: 'abc' }] })).status,
    ).toBe(400);
    expect(
      err(() => parseFilter({ ...base, where: [{ field: 'level', op: '=', value: { a: 1 } }] })).status,
    ).toBe(400);
  });

  it('flags free-text searches over more than 24h with no field filter as too large', () => {
    const wide = { ...base, from: NOW - 7 * 86_400_000 };
    const e = err(() => parseFilter({ ...wide, where: [{ text: 'timeout' }] }));
    expect(e.status).toBe(422);
    expect(e.code).toBe('query_too_large');
    expect(
      parseFilter({ ...wide, where: [{ text: 'timeout' }, { field: 'level', op: '=', value: 'error' }] }),
    ).toBeTruthy();
  });

  it('round-trips cursors and rejects tampered ones', () => {
    const c = encodeCursor({ ts: 5, id: 'evt_1' });
    expect(decodeCursor(c)).toEqual({ ts: 5, id: 'evt_1' });
    expect(err(() => parseFilter({ ...base, cursor: 'not-a-cursor' })).status).toBe(400);
  });
});

describe('pickInterval', () => {
  it('picks a nice bucket size for about 60 bars', () => {
    expect(pickInterval(0, 15 * 60_000)).toBe(15_000);
    expect(pickInterval(0, 3_600_000)).toBe(60_000);
    expect(pickInterval(0, 86_400_000)).toBe(30 * 60_000);
  });
});
