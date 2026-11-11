// Turns a validated Filter into SQL for Basin. Values never go in raw: they go through `b.param()`,
// which the dialect renders as an escaped literal (Basin SQL has no bound parameters).

/**
 * @typedef {import('./filter.js').Filter} Filter
 * @typedef {import('./filter.js').Clause} Clause
 * @typedef {{
 *   table: string,
 *   fieldsColumn: string,
 *   param: (b: Builder, value: unknown) => string,
 *   fieldText: (path: string) => string,
 *   fieldNumber: (path: string) => string,
 *   fieldExists: (path: string) => string,
 *   fieldIsNumber: (path: string) => string,
 *   path: (key: string) => string,
 *   like: (expr: string, pattern: string) => string,
 *   bucket: (b: Builder, interval: number) => string,
 *   percentile?: (numberExpr: string) => string,
 * }} Dialect
 */

export class Builder {
  /** @param {Dialect} dialect */
  constructor(dialect) {
    this.d = dialect;
    /** @type {unknown[]} */
    this.params = [];
  }

  /** @param {unknown} value */
  param(value) {
    return this.d.param(this, value);
  }
}

/**
 * Escapes LIKE wildcards (and backslash, Basin's only LIKE escape character).
 * @param {string} s
 */
function escapeLike(s) {
  return [...s].map((ch) => (ch === '%' || ch === '_' || ch === '\\' ? `\\${ch}` : ch)).join('');
}

/** Booleans compare as SQLite/JSON text would render them. @param {unknown} v */
function asText(v) {
  if (v === true) return '1';
  if (v === false) return '0';
  return String(v);
}

/**
 * Text expression for a field reference, plus its JSON path param when it is a `fields.*` key.
 * @param {Builder} b
 * @param {string} field
 */
function textExpr(b, field) {
  if (!field.startsWith('fields.')) return field;
  return b.d.fieldText(b.param(b.d.path(field.slice(7))));
}

/**
 * @param {Builder} b
 * @param {Clause} c
 */
function clauseSql(b, c) {
  if ('text' in c) {
    const pattern = `%${escapeLike(c.text)}%`;
    return `(${b.d.like('message', b.param(pattern))} OR ${b.d.like(b.d.fieldsColumn, b.param(pattern))})`;
  }
  const isField = c.field.startsWith('fields.');
  switch (c.op) {
    case 'exists':
      return isField ? b.d.fieldExists(b.param(b.d.path(c.field.slice(7)))) : 'TRUE';
    case 'contains':
      return b.d.like(textExpr(b, c.field), b.param(`%${escapeLike(asText(c.value))}%`));
    case 'in':
    case 'not_in': {
      const expr = textExpr(b, c.field);
      const list = /** @type {unknown[]} */ (c.value).map((v) => b.param(asText(v))).join(', ');
      return c.op === 'in' ? `${expr} IN (${list})` : `(${expr} IS NULL OR ${expr} NOT IN (${list}))`;
    }
    case '=':
      return `${textExpr(b, c.field)} = ${b.param(asText(c.value))}`;
    case '!=': {
      const expr = textExpr(b, c.field);
      return `(${expr} IS NULL OR ${expr} != ${b.param(asText(c.value))})`;
    }
    default: {
      const expr = b.d.fieldNumber(b.param(b.d.path(c.field.slice(7))));
      return `${expr} ${c.op} ${b.param(Number(c.value))}`;
    }
  }
}

/** How far a log's own time (ts) can be from when it reached Basin (__ingest_ts). */
export const INGEST_MARGIN_MS = 25 * 60 * 60 * 1000;

/** Unix ms as the RFC 3339 UTC timestamp Basin SQL compares __ingest_ts with. @param {number} ms */
export function ingestTs(ms) {
  return new Date(ms).toISOString();
}

/**
 * WHERE clause shared by every query: project, time range, then the client's clauses.
 * @param {Builder} b
 * @param {Filter} f
 */
function whereSql(b, f) {
  const parts = [
    `project_id = ${b.param(f.project_id)}`,
    // Basin stores files by the day they arrived (__ingest_ts), so this limits a query to the few days that can
    // hold the range instead of every file in the table. ts is the client's time, accepted within ±24h of arrival
    // (src/ingest/normalize.js); the margin adds an hour for pipeline delay.
    `__ingest_ts >= ${b.param(ingestTs(f.from - INGEST_MARGIN_MS))}`,
    `__ingest_ts < ${b.param(ingestTs(f.to + INGEST_MARGIN_MS))}`,
    `ts >= ${b.param(f.from)}`,
    `ts < ${b.param(f.to)}`,
  ];
  for (const c of f.where) parts.push(clauseSql(b, c));
  return parts.join(' AND ');
}

/**
 * @param {Filter} f
 * @param {Dialect} dialect
 */
export function buildEventsSql(f, dialect) {
  const b = new Builder(dialect);
  let where = whereSql(b, f);
  if (f.cursor) {
    where += ` AND (ts < ${b.param(f.cursor.ts)} OR (ts = ${b.param(f.cursor.ts)} AND id < ${b.param(f.cursor.id)}))`;
  }
  const sql =
    `SELECT id, ts, source_id, source, level, message, ${b.d.fieldsColumn} AS fields FROM ${b.d.table} ` +
    `WHERE ${where} ORDER BY ts DESC, id DESC LIMIT ${b.param(f.limit + 1)}`;
  return { sql, params: b.params };
}

/**
 * @param {Filter} f
 * @param {number} interval
 * @param {Dialect} dialect
 */
export function buildHistogramSql(f, interval, dialect) {
  const b = new Builder(dialect);
  const bucket = b.d.bucket(b, interval);
  const sql = `SELECT ${bucket} AS t, level, COUNT(*) AS n FROM ${b.d.table} WHERE ${whereSql(b, f)} GROUP BY t, level ORDER BY t`;
  return { sql, params: b.params };
}

/**
 * Builds the queries behind a chart: an overall value, top groups, a time series, and
 * (given the top group keys) one series per group. avg / p95 use nearest-rank on numeric `field`.
 * @param {Filter} f
 * @param {{ measure: 'count' | 'count_over_time' | 'avg' | 'p95', field?: string, group_by?: string, interval: number }} spec
 * @param {Dialect} dialect
 */
export function buildAggregateSql(f, spec, dialect) {
  const d = new Builder(dialect).d;
  const counting = spec.measure === 'count' || spec.measure === 'count_over_time';
  const groupField = counting ? spec.field : (spec.group_by ?? 'source_id');

  /**
   * @param {{ group?: boolean, bucket?: boolean, onlyKeys?: string[] }} shape
   */
  const build = ({ group = false, bucket = false, onlyKeys }) => {
    const b = new Builder(d);
    const keys = [];
    if (group && groupField) keys.push(`${textExpr(b, groupField)} AS k`);
    if (bucket) keys.push(`${b.d.bucket(b, spec.interval)} AS t`);
    const names = keys.map((k) => k.slice(-1));
    const select = keys.map((k) => `${k}, `).join('');
    // Params bind positionally, so build in SQL text order: SELECT keys, value, then WHERE.
    const path = counting ? '' : d.path(/** @type {string} */ (spec.field).slice(7));
    const num = counting ? '' : d.fieldNumber(b.param(path));
    let where = whereSql(b, f);
    if (!counting) where += ` AND ${d.fieldIsNumber(b.param(path))}`;
    if (onlyKeys)
      where += ` AND ${textExpr(b, /** @type {string} */ (groupField))} IN (${onlyKeys.map((k) => b.param(k)).join(', ')})`;
    const groupBy = names.length ? ` GROUP BY ${names.join(', ')}` : '';
    const order = bucket ? ' ORDER BY t' : names.length ? ' ORDER BY v DESC, k LIMIT 10' : '';

    if (spec.measure !== 'p95' || d.percentile) {
      const agg = counting
        ? 'COUNT(*)'
        : spec.measure === 'avg'
          ? `AVG(${num})`
          : /** @type {(x: string) => string} */ (d.percentile)(num);
      return {
        sql: `SELECT ${select}${agg} AS v FROM ${d.table} WHERE ${where}${groupBy}${order}`,
        params: b.params,
      };
    }
    const over = names.length ? `PARTITION BY ${names.join(', ')}` : '';
    const sql =
      `WITH s AS (SELECT ${select}${num} AS x FROM ${d.table} WHERE ${where}), ` +
      `r AS (SELECT *, ROW_NUMBER() OVER (${over} ORDER BY x) AS rn, COUNT(*) OVER (${over}) AS c FROM s) ` +
      `SELECT ${names.map((n) => `${n}, `).join('')}MIN(x) AS v FROM r WHERE rn >= 0.95 * c${groupBy}${order}`;
    return { sql, params: b.params };
  };

  return {
    value: build({}),
    groups: groupField ? build({ group: true }) : null,
    series: build({ bucket: true }),
    /** @param {string[]} keys */
    groupSeries: (keys) =>
      groupField && keys.length ? build({ group: true, bucket: true, onlyKeys: keys }) : null,
  };
}
