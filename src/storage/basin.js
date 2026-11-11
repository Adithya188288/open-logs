// BasinStorage: writes go to a Basin Pipelines stream (binding), reads go to Basin SQL over HTTP.
//
// Verified against developers.cloudflare.com on 2026-10-30:
// - stream binding: wrangler `pipelines: [{ binding, stream }]`, `await env.LOG_STREAM.send(records)`
// - Basin SQL: POST https://api.sql.cloudflarestorage.com/api/v1/accounts/{account}/basin-sql/query/{bucket}
//   with `{ "query": "…" }` and a bearer token. There is NO parameter binding, so this dialect inlines
//   values as escaped literals (see sqlLiteral). Values only ever come from a validated Filter.
// Verified on real Basin (staging, 2026-10-30): responses are `{ result: { schema, rows: [{…}], metrics }, success }`;
// backslash is an ordinary character inside string literals; LIKE only accepts ESCAPE '\'.
import { HttpError } from '../http.js';
import { buildEventsSql, buildHistogramSql, INGEST_MARGIN_MS, ingestTs } from '../query/sql.js';
import { runAggregate } from './aggregate.js';
import { eventsPage, histogramBuckets } from './shape.js';

const SQL_API = 'https://api.sql.cloudflarestorage.com/api/v1/accounts';
const TABLE_NAME = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
// The Iceberg sink rolls files every 60s (its minimum) and then commits them to the catalog. On staging
// (2026-10-30) events became queryable 1.5–3.5 minutes after ingest, so freshness is reported against 3 min.
const INGEST_LAG_MS = 180_000;
// How far back "newest event" looks. The dashboard asks every 30 s only to notice new arrivals, which are always
// recent, so it looks at 15 minutes; live tail asks once per view for its "newest event arrived …" message.
export const NEWEST_RECENT_MS = 15 * 60 * 1000;
const NEWEST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// Basin SQL now and then never answers a query that normally takes ~1s (2026-11-01, open-logs-test-e2e: 1 in
// 56 and 1 in 110 parallel queries; the Worker waited 90s on 4ms of CPU; not in Cloudflare's docs). So each
// attempt gets a time limit, and a stuck one is tried once more before the request fails.
const ATTEMPT_TIMEOUT_MS = 15_000;
const ATTEMPTS = 2;
// Basin creates the table when the sink writes its first file, about a minute after a new install's first log.
// Until then every query answers 404 with this code ("iceberg table not found"): that just means no logs yet.
const TABLE_NOT_FOUND = 40010;

/**
 * Renders a value as a SQL literal. Strings are single-quoted with quotes doubled; NUL is removed;
 * backslashes become chr(92).
 * @param {unknown} value
 */
export function sqlLiteral(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number in query');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  // Backslashes go out as chr(92) so the literal means the same whether or not the parser treats `\` as an
  // escape character (Basin SQL's quoting rules are undocumented).
  const quoted = String(value).replaceAll('\u0000', '').replaceAll("'", "''");
  return `'${quoted.split('\\').join("' || chr(92) || '")}'`;
}

/**
 * @param {string} table  `namespace.table`, e.g. `open_logs.events`
 * @returns {import('../query/sql.js').Dialect}
 */
export function basinDialect(table) {
  if (!TABLE_NAME.test(table)) throw new Error('BASIN_TABLE must look like namespace.table');
  return {
    table,
    fieldsColumn: 'fields',
    // JSON paths are arrays of keys, rendered as separate literal arguments.
    param: (_b, value) => (Array.isArray(value) ? value.map(sqlLiteral).join(', ') : sqlLiteral(value)),
    path: (key) => /** @type {any} */ (key.split('.')),
    fieldText: (p) => `json_as_text(fields, ${p})`,
    fieldNumber: (p) => `json_get_float(fields, ${p})`,
    fieldExists: (p) => `json_contains(fields, ${p})`,
    fieldIsNumber: (p) => `json_get_float(fields, ${p}) IS NOT NULL`,
    // Basin SQL only accepts backslash as the LIKE escape character (verified on real Basin).
    like: (expr, p) => `lower(${expr}) LIKE lower(${p}) ESCAPE '\\'`,
    bucket: (b, interval) => `(ts / ${b.param(Math.trunc(interval))}) * ${b.param(Math.trunc(interval))}`,
    percentile: (x) => `approx_percentile_cont(${x}, 0.95)`,
  };
}

/** Basin SQL answers `{ result: { rows: [{…}], metrics }, success }` (verified on real Basin, 2026-10-30). @param {any} body */
function rowsOf(body) {
  const rows = body?.result?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** @implements {import('./index.js').LogStorage} */
export class BasinStorage {
  /**
   * @param {Env} env
   */
  constructor(env) {
    this.env = env;
    this.dialect = basinDialect(String(env.BASIN_TABLE ?? 'open_logs.events'));
    this.lagMs = INGEST_LAG_MS;
  }

  /** @param {{ sql: string }} q */
  async all(q) {
    const { BASIN_ACCOUNT_ID, BASIN_BUCKET, BASIN_SQL_TOKEN } = this.env;
    if (!BASIN_ACCOUNT_ID || !BASIN_BUCKET || !BASIN_SQL_TOKEN) {
      throw new Error('Basin SQL is not configured (BASIN_ACCOUNT_ID, BASIN_BUCKET, BASIN_SQL_TOKEN)');
    }
    const url = `${SQL_API}/${encodeURIComponent(BASIN_ACCOUNT_ID)}/basin-sql/query/${encodeURIComponent(BASIN_BUCKET)}`;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${BASIN_SQL_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ query: q.sql }),
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        });
        const body = await res.json().catch(() => ({}));
        if (body?.errors?.some((/** @type {any} */ e) => e.code === TABLE_NOT_FOUND)) return [];
        if (!res.ok || body?.success === false) {
          const message =
            body?.errors?.map((/** @type {any} */ e) => e.message).join('; ') ||
            `Basin SQL failed (${res.status})`;
          throw new Error(message);
        }
        return rowsOf(body);
      } catch (err) {
        const stuck = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        if (!stuck) throw err;
        if (attempt === ATTEMPTS) {
          throw new HttpError(504, 'basin_timeout', 'Basin took too long to answer. Try again.');
        }
      }
    }
  }

  /** @param {import('./index.js').StoredEvent[]} events */
  async write(events) {
    if (!this.env.LOG_STREAM) throw new Error('LOG_STREAM pipelines binding is missing');
    await this.env.LOG_STREAM.send(events);
  }

  /** @param {import('../query/filter.js').Filter} filter */
  async query(filter) {
    return eventsPage(await this.all(buildEventsSql(filter, this.dialect)), filter.limit);
  }

  /**
   * @param {import('../query/filter.js').Filter} filter
   * @param {number} interval
   */
  async histogram(filter, interval) {
    return histogramBuckets(
      await this.all(buildHistogramSql(filter, interval, this.dialect)),
      filter.from,
      filter.to,
      interval,
    );
  }

  /**
   * @param {import('../query/filter.js').Filter} filter
   * @param {import('./index.js').AggregateSpec} spec
   */
  async aggregate(filter, spec) {
    return runAggregate((q) => this.all(q), this.dialect, filter, spec);
  }

  /** @param {string} projectId @param {number} [lookbackMs] */
  async newest(projectId, lookbackMs = NEWEST_LOOKBACK_MS) {
    const since = Date.now() - lookbackMs;
    const rows = await this.all({
      sql:
        `SELECT MAX(ts) AS ts FROM ${this.dialect.table} WHERE project_id = ${sqlLiteral(projectId)}` +
        ` AND __ingest_ts >= ${sqlLiteral(ingestTs(since - INGEST_MARGIN_MS))} AND ts >= ${since}`,
    });
    const ts = rows[0]?.ts;
    return ts === null || ts === undefined ? null : Number(ts);
  }

  /** Basin SQL is read-only: a deleted project's files stay in R2 until removed there. */
  async deleteProject() {}
}
