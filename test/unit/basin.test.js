import { describe, expect, it } from 'vitest';
import { parseFilter } from '../../src/query/filter.js';
import { buildAggregateSql, buildEventsSql, buildHistogramSql } from '../../src/query/sql.js';
import { BasinStorage, basinDialect, sqlLiteral } from '../../src/storage/basin.js';

const NOW = 1_793_356_800_000;
const d = basinDialect('open_logs.events');
const f = (where) => parseFilter({ project_id: 'prj_a', from: NOW - 60_000, to: NOW, where });

describe('Basin SQL literals', () => {
  it('quotes strings and doubles single quotes', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral("x' OR '1'='1")).toBe("'x'' OR ''1''=''1'");
    expect(sqlLiteral('back\\slash')).toBe("'back' || chr(92) || 'slash'");
  });

  it('cannot be broken out of with a backslash, whichever way the parser reads it', () => {
    const lit = sqlLiteral("\\' OR 1=1 --");
    expect(lit).toBe("'' || chr(92) || ''' OR 1=1 --'");
    expect(lit).not.toContain('\\');
  });

  it('only accepts finite numbers and strips NUL', () => {
    expect(sqlLiteral(42)).toBe('42');
    expect(sqlLiteral(-1.5)).toBe('-1.5');
    expect(() => sqlLiteral(Number.NaN)).toThrow();
    expect(sqlLiteral('a\u0000b')).toBe("'ab'");
  });

  it('rejects an unsafe table name', () => {
    expect(() => basinDialect('logs; DROP TABLE x')).toThrow();
  });
});

describe('Basin dialect SQL', () => {
  it('inlines escaped values and never leaves placeholders', () => {
    const evil = "api' OR 1=1 --";
    const { sql, params } = buildEventsSql(
      f([{ field: 'source', op: '=', value: evil }, { text: "50%_' x" }]),
      d,
    );
    expect(params).toEqual([]);
    expect(sql).not.toContain('?');
    expect(sql).toContain("source = 'api'' OR 1=1 --'");
    expect(sql).toContain("FROM open_logs.events WHERE project_id = 'prj_a'");
    // Real Basin SQL only accepts backslash as the LIKE escape (verified on staging 2026-10-30).
    expect(sql).toContain("lower(message) LIKE lower('%50' || chr(92) || '%' || chr(92) || '_'' x%') ESCAPE '\\'");
  });

  it('walks nested JSON keys as separate literals', () => {
    const { sql } = buildEventsSql(f([{ field: 'fields.http.status', op: '>=', value: 500 }]), d);
    expect(sql).toContain("json_get_float(fields, 'http', 'status') >= 500");
  });

  it('buckets with integer division and uses approx percentiles', () => {
    expect(buildHistogramSql(f([]), 15000, d).sql).toContain('(ts / 15000) * 15000 AS t');
    const q = buildAggregateSql(f([]), { measure: 'p95', field: 'fields.duration_ms', interval: 60000 }, d);
    expect(q.value.sql).toContain("approx_percentile_cont(json_get_float(fields, 'duration_ms'), 0.95)");
  });
});

describe('BasinStorage', () => {
  it('writes events through the stream binding', async () => {
    const sent = [];
    const s = new BasinStorage(env({ LOG_STREAM: { send: async (rows) => sent.push(...rows) } }));
    await s.write([
      { id: 'e1', ts: 1, project_id: 'p', source: 'api', level: 'info', message: 'm', fields: '{}' },
    ]);
    expect(sent).toEqual([
      { id: 'e1', ts: 1, project_id: 'p', source: 'api', level: 'info', message: 'm', fields: '{}' },
    ]);
  });

  it('queries Basin SQL over HTTP with the bearer token and parses rows', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        success: true,
        result: {
          rows: [{ id: 'e1', ts: 5, source: 'api', level: 'error', message: 'boom', fields: '{"a":1}' }],
        },
      });
    };
    const s = new BasinStorage(env({}), fetcher);
    const page = await s.query(f([]));
    expect(page.events).toEqual([
      { id: 'e1', ts: 5, source: 'api', level: 'error', message: 'boom', fields: { a: 1 } },
    ]);
    expect(calls[0].url).toBe(
      'https://api.sql.cloudflarestorage.com/api/v1/accounts/acc123/basin-sql/query/logs-bucket',
    );
    expect(calls[0].init.headers.authorization).toBe('Bearer sql-token');
    expect(JSON.parse(calls[0].init.body).query).toMatch(/^SELECT id, ts/);
  });

  it('accepts column/row array responses too', async () => {
    const fetcher = async () => Response.json({ result: { columns: ['ts'], rows: [[1234]] } });
    expect(await new BasinStorage(env({}), fetcher).newest('prj_a')).toBe(1234);
  });

  it('surfaces Basin SQL errors (and scan limits) as errors', async () => {
    const fetcher = async () =>
      Response.json(
        { success: false, errors: [{ message: 'query would scan too much data' }] },
        { status: 400 },
      );
    await expect(new BasinStorage(env({}), fetcher).query(f([]))).rejects.toThrow(/scan too much/);
  });
});

function env(extra) {
  return {
    LOG_STORAGE: 'basin',
    BASIN_ACCOUNT_ID: 'acc123',
    BASIN_BUCKET: 'logs-bucket',
    BASIN_TABLE: 'open_logs.events',
    BASIN_SQL_TOKEN: 'sql-token',
    ...extra,
  };
}
