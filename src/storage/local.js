// LocalStorage: logs in the D1 `logs` table. Used for local dev and small installs.
import { buildEventsSql, buildHistogramSql, buildOverviewSql } from '../query/sql.js';
import { runAggregate } from './aggregate.js';
import { eventsPage, histogramBuckets, overviewShape } from './shape.js';

const COLUMNS_PER_ROW = 7;
const ROWS_PER_INSERT = Math.floor(100 / COLUMNS_PER_ROW); // D1 allows 100 bound params per statement.

/** @implements {import('./index.js').LogStorage} */
export class LocalStorage {
  /** @param {D1Database} db */
  constructor(db) {
    this.db = db;
    /** @type {'local'} */
    this.mode = 'local';
    this.lagMs = 0;
  }

  /** @param {{ sql: string, params: unknown[] }} q */
  async all(q) {
    const { results } = await this.db
      .prepare(q.sql)
      .bind(...q.params)
      .all();
    return /** @type {Record<string, unknown>[]} */ (results);
  }

  /** @param {import('./index.js').StoredEvent[]} events */
  async write(events) {
    const statements = [];
    for (let i = 0; i < events.length; i += ROWS_PER_INSERT) {
      const chunk = events.slice(i, i + ROWS_PER_INSERT);
      const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = chunk.flatMap((e) => [e.id, e.ts, e.project_id, e.source, e.level, e.message, e.fields]);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO logs (id, ts, project_id, source, level, message, fields_json) VALUES ${values}`,
          )
          .bind(...params),
      );
    }
    if (statements.length) await this.db.batch(statements);
  }

  /** @param {import('../query/filter.js').Filter} filter */
  async query(filter) {
    return eventsPage(await this.all(buildEventsSql(filter, 'd1')), filter.limit);
  }

  /**
   * @param {import('../query/filter.js').Filter} filter
   * @param {number} interval
   */
  async histogram(filter, interval) {
    const rows = await this.all(buildHistogramSql(filter, interval, 'd1'));
    return histogramBuckets(rows, filter.from, filter.to, interval);
  }

  /**
   * @param {import('../query/filter.js').Filter} filter
   * @param {import('./index.js').AggregateSpec} spec
   */
  async aggregate(filter, spec) {
    return runAggregate((q) => this.all(q), 'd1', filter, spec);
  }

  /** @param {string} projectId */
  async newest(projectId) {
    const row = await this.db
      .prepare('SELECT MAX(ts) AS ts FROM logs WHERE project_id = ?')
      .bind(projectId)
      .first();
    return row?.ts == null ? null : Number(row.ts);
  }

  /**
   * @param {string[]} projectIds
   * @param {number} from
   * @param {number} to
   * @param {number} interval
   */
  async overview(projectIds, from, to, interval) {
    if (!projectIds.length) return {};
    const rows = await this.all(buildOverviewSql(projectIds, from, to, interval, 'd1'));
    return overviewShape(rows, projectIds, from, to, interval);
  }

  /** @param {string} projectId */
  async deleteProject(projectId) {
    await this.db.prepare('DELETE FROM logs WHERE project_id = ?').bind(projectId).run();
  }
}
