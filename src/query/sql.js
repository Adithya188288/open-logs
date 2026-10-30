// Turns a validated Filter into parameterised SQL for a storage dialect.
// Values are never interpolated: they go through `b.param()`.

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
 * }} Dialect
 */

class Builder {
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

/** @type {Dialect} */
const D1 = {
  table: 'logs',
  fieldsColumn: 'fields_json',
  param: (b, value) => {
    b.params.push(value);
    return '?';
  },
  path: (key) =>
    `$.${key
      .split('.')
      .map((s) => `"${s}"`)
      .join('.')}`,
  fieldText: (p) => `CAST(json_extract(fields_json, ${p}) AS TEXT)`,
  fieldNumber: (p) => `CAST(json_extract(fields_json, ${p}) AS REAL)`,
  fieldExists: (p) => `json_type(fields_json, ${p}) IS NOT NULL`,
  fieldIsNumber: (p) => `json_type(fields_json, ${p}) IN ('integer', 'real')`,
  like: (expr, p) => `${expr} LIKE ${p} ESCAPE '\\'`,
  bucket: (b, interval) => `CAST(ts / ${b.param(interval)} AS INTEGER) * ${b.param(interval)}`,
};

/** @type {Record<string, Dialect>} */
export const DIALECTS = { d1: D1 };

/**
 * @param {string} name
 * @param {Dialect} dialect
 */
export function registerDialect(name, dialect) {
  DIALECTS[name] = dialect;
}

/** @param {string} s */
function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
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

/**
 * WHERE clause shared by every query: project, time range, then the client's clauses.
 * @param {Builder} b
 * @param {Filter} f
 */
function whereSql(b, f) {
  const parts = [
    `project_id = ${b.param(f.project_id)}`,
    `ts >= ${b.param(f.from)}`,
    `ts < ${b.param(f.to)}`,
  ];
  for (const c of f.where) parts.push(clauseSql(b, c));
  return parts.join(' AND ');
}

/**
 * @param {Filter} f
 * @param {string} dialect
 */
export function buildEventsSql(f, dialect) {
  const b = new Builder(DIALECTS[dialect]);
  let where = whereSql(b, f);
  if (f.cursor) {
    where += ` AND (ts < ${b.param(f.cursor.ts)} OR (ts = ${b.param(f.cursor.ts)} AND id < ${b.param(f.cursor.id)}))`;
  }
  const sql =
    `SELECT id, ts, source, level, message, ${b.d.fieldsColumn} AS fields FROM ${b.d.table} ` +
    `WHERE ${where} ORDER BY ts DESC, id DESC LIMIT ${b.param(f.limit + 1)}`;
  return { sql, params: b.params };
}

/**
 * @param {Filter} f
 * @param {number} interval
 * @param {string} dialect
 */
export function buildHistogramSql(f, interval, dialect) {
  const b = new Builder(DIALECTS[dialect]);
  const bucket = b.d.bucket(b, interval);
  const sql = `SELECT ${bucket} AS t, level, COUNT(*) AS n FROM ${b.d.table} WHERE ${whereSql(b, f)} GROUP BY t, level ORDER BY t`;
  return { sql, params: b.params };
}

/**
 * Builds the three queries behind a chart: a single value, top groups and a time series.
 * avg / p95 use nearest-rank on numeric values of `field`.
 * @param {Filter} f
 * @param {{ measure: 'count' | 'count_over_time' | 'avg' | 'p95', field?: string, group_by?: string, interval: number }} spec
 * @param {string} dialect
 */
export function buildAggregateSql(f, spec, dialect) {
  const d = DIALECTS[dialect];
  const counting = spec.measure === 'count' || spec.measure === 'count_over_time';
  const groupField = counting ? spec.field : (spec.group_by ?? 'source');

  /**
   * @param {(b: Builder) => string | null} keyOf  group key expression, or null for none
   */
  const one = (keyOf) => {
    const b = new Builder(d);
    const key = keyOf(b);
    const keySelect = key ? `${key} AS k, ` : '';
    if (counting) {
      const where = whereSql(b, f);
      const group = key ? ` GROUP BY k ORDER BY v DESC, k LIMIT 10` : '';
      return {
        sql: `SELECT ${keySelect}COUNT(*) AS v FROM ${d.table} WHERE ${where}${group}`,
        params: b.params,
      };
    }
    const path = d.path(/** @type {string} */ (spec.field).slice(7));
    const num = d.fieldNumber(b.param(path));
    const where = `${whereSql(b, f)} AND ${d.fieldIsNumber(b.param(path))}`;
    if (spec.measure === 'avg') {
      const group = key ? ` GROUP BY k ORDER BY v DESC LIMIT 10` : '';
      return {
        sql: `SELECT ${keySelect}AVG(${num}) AS v FROM ${d.table} WHERE ${where}${group}`,
        params: b.params,
      };
    }
    const over = key ? 'PARTITION BY k' : '';
    const sql =
      `WITH s AS (SELECT ${keySelect}${num} AS x FROM ${d.table} WHERE ${where}), ` +
      `r AS (SELECT *, ROW_NUMBER() OVER (${over} ORDER BY x) AS rn, COUNT(*) OVER (${over}) AS c FROM s) ` +
      `SELECT ${key ? 'k, ' : ''}MIN(x) AS v FROM r WHERE rn >= 0.95 * c` +
      (key ? ' GROUP BY k ORDER BY v DESC LIMIT 10' : '');
    return { sql, params: b.params };
  };

  return {
    value: one(() => null),
    groups: groupField ? one((b) => textExpr(b, groupField)) : null,
    series: one((b) => b.d.bucket(b, spec.interval)),
  };
}

/**
 * Event counts per project per bucket, for the projects page.
 * @param {string[]} projectIds
 * @param {number} from
 * @param {number} to
 * @param {number} interval
 * @param {string} dialect
 */
export function buildOverviewSql(projectIds, from, to, interval, dialect) {
  const b = new Builder(DIALECTS[dialect]);
  const bucket = b.d.bucket(b, interval);
  const ids = projectIds.map((id) => b.param(id)).join(', ');
  const sql =
    `SELECT project_id, ${bucket} AS t, COUNT(*) AS n, ` +
    `SUM(CASE WHEN level IN ('error', 'fatal') THEN 1 ELSE 0 END) AS e FROM ${b.d.table} ` +
    `WHERE project_id IN (${ids}) AND ts >= ${b.param(from)} AND ts < ${b.param(to)} GROUP BY project_id, t`;
  return { sql, params: b.params };
}
