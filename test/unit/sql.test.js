import { describe, expect, it } from 'vitest';
import { parseFilter } from '../../src/query/filter.js';
import { buildEventsSql, buildHistogramSql } from '../../src/query/sql.js';

const NOW = 1_793_356_800_000;
const filter = (where) => parseFilter({ project_id: 'prj_a', from: NOW - 60_000, to: NOW, where });

describe('buildEventsSql (d1)', () => {
  it('binds every value as a parameter', () => {
    const evil = "x' OR 1=1 --";
    const { sql, params } = buildEventsSql(
      filter([
        { field: 'source', op: '=', value: evil },
        { field: 'fields.order_id', op: '=', value: 4821 },
        { text: evil },
      ]),
      'd1',
    );
    expect(sql).not.toContain(evil);
    expect(params).toContain(evil);
    expect(sql).toMatch(/ORDER BY ts DESC, id DESC LIMIT \?$/);
    expect(params.at(-1)).toBe(101);
  });

  it('turns field keys into quoted JSON paths passed as parameters', () => {
    const { sql, params } = buildEventsSql(
      filter([{ field: 'fields.http.status', op: '>=', value: 500 }]),
      'd1',
    );
    expect(sql).toContain('json_extract(fields_json, ?)');
    expect(params).toContain('$."http"."status"');
  });

  it('builds a histogram grouped by bucket and level', () => {
    const { sql, params } = buildHistogramSql(filter([]), 1000, 'd1');
    expect(sql).toContain('GROUP BY t, level');
    expect(params.slice(0, 2)).toEqual([1000, 1000]);
  });
});
