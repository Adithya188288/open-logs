// Saved views, dashboards and charts. Filters are stored as validated `where` clauses.
import { closeBeforeDelete } from '../alerts/alerts.js';
import { randomId } from '../crypto.js';
import { asObject, HttpError, json, readJson, requireString } from '../http.js';
import { parseField, parseFilter } from '../query/filter.js';
import { findProject } from './projects.js';

const RANGES = new Set(['15m', '1h', '24h', '7d']);
const MEASURES = new Set(['count', 'count_over_time', 'avg', 'p95']);
const VIZ = new Set(['bar', 'pie', 'line', 'number']);
const SIZES = new Set(['sm', 'md', 'lg']);
const CHART_COLUMNS = 'id, dashboard_id, title, filter_json, field, measure, viz, position, size, created_at';
/** Charts with their alert, if any: `alert_open` says whether it has an open incident. */
const CHART_SELECT = `SELECT ${CHART_COLUMNS.split(', ')
  .map((col) => `c.${col}`)
  .join(', ')}, a.id AS alert_id, a.paused AS alert_paused,
  EXISTS (SELECT 1 FROM incidents i WHERE i.alert_id = a.id AND i.resolved_at IS NULL) AS alert_open
  FROM charts c LEFT JOIN alerts a ON a.chart_id = c.id`;

const ERRORS = [{ field: 'level', op: 'in', value: ['error', 'fatal'] }];
/** Charts every new project's Overview dashboard starts with. */
const STARTER_CHARTS = [
  { title: 'Events', where: [], field: null, measure: 'count', viz: 'number', size: 'sm' },
  { title: 'Errors', where: ERRORS, field: null, measure: 'count', viz: 'number', size: 'sm' },
  {
    title: 'Warnings',
    where: [{ field: 'level', op: '=', value: 'warn' }],
    field: null,
    measure: 'count',
    viz: 'number',
    size: 'sm',
  },
  { title: 'Events by level', where: [], field: 'level', measure: 'count_over_time', viz: 'bar', size: 'lg' },
  { title: 'Events by source', where: [], field: 'source', measure: 'count', viz: 'pie', size: 'md' },
  { title: 'Top errors', where: ERRORS, field: 'message', measure: 'count', viz: 'bar', size: 'md' },
];

/**
 * Validates `{ where, range? }` by running it through the query filter parser.
 * @param {unknown} raw
 * @param {boolean} allowRange
 */
function parseStoredFilter(raw, allowRange) {
  const f = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const { where } = parseFilter({ project_id: 'x', from: 0, to: 1, where: f.where ?? [] });
  /** @type {{ where: unknown[], range?: string }} */
  const out = { where };
  if (allowRange && f.range !== undefined) {
    if (typeof f.range !== 'string' || !RANGES.has(f.range))
      throw new HttpError(400, 'invalid_field', 'range is invalid');
    out.range = f.range;
  }
  return out;
}

/** @param {Record<string, unknown>} row */
function chartOut(row) {
  const { filter_json, alert_id, alert_paused, alert_open, ...rest } = row;
  const out = { ...rest, filter: JSON.parse(String(filter_json)) };
  if (alert_id === undefined) return out;
  return {
    ...out,
    alert: alert_id ? { id: alert_id, paused: Boolean(alert_paused), open: Boolean(alert_open) } : null,
  };
}

/**
 * Validates a chart body. With `prev`, missing keys keep their previous value (PATCH).
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} [prev]
 */
function parseChart(body, prev) {
  const pick = (/** @type {string} */ k) => (body[k] !== undefined ? body[k] : prev?.[k]);
  const title = requireString(pick('title'), 'title', { max: 100 });
  const measure = String(pick('measure'));
  if (!MEASURES.has(measure))
    throw new HttpError(400, 'invalid_field', 'measure is invalid', { field: 'measure' });
  const viz = String(pick('viz'));
  if (!VIZ.has(viz)) throw new HttpError(400, 'invalid_field', 'viz is invalid', { field: 'viz' });
  const size = String(pick('size') ?? 'md');
  if (!SIZES.has(size)) throw new HttpError(400, 'invalid_field', 'size is invalid', { field: 'size' });
  const rawField = pick('field');
  const field = rawField ? parseField(rawField) : null;
  if ((measure === 'avg' || measure === 'p95') && !field?.startsWith('fields.')) {
    throw new HttpError(400, 'invalid_field', `${measure} needs a numeric fields.* field`, {
      field: 'field',
    });
  }
  const filter = parseStoredFilter(body.filter !== undefined ? body.filter : prev?.filter, false);
  return { title, measure, viz, size, field, filter };
}

/**
 * @param {Env} env
 * @param {string} id
 */
async function findDashboard(env, id) {
  const d = await env.DB.prepare('SELECT id, project_id, name, created_at FROM dashboards WHERE id = ?')
    .bind(id)
    .first();
  if (!d) throw new HttpError(404, 'not_found', 'Dashboard not found');
  return d;
}

/**
 * @param {Env} env
 * @param {string} id
 */
async function findChart(env, id) {
  const c = await env.DB.prepare(`${CHART_SELECT} WHERE c.id = ?`).bind(id).first();
  if (!c) throw new HttpError(404, 'not_found', 'Chart not found');
  return chartOut(c);
}

/**
 * @param {Env} env
 * @param {string} dashboardId
 * @param {ReturnType<typeof parseChart>} chart
 */
function insertChart(env, dashboardId, chart) {
  const id = randomId('cht');
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO charts (id, dashboard_id, title, filter_json, field, measure, viz, position, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM charts WHERE dashboard_id = ?), ?, ?)`,
  ).bind(
    id,
    dashboardId,
    chart.title,
    JSON.stringify(chart.filter),
    chart.field,
    chart.measure,
    chart.viz,
    dashboardId,
    chart.size,
    now,
  );
  return { id, stmt };
}

/**
 * Statements that create a project's Overview dashboard with starter charts.
 * @param {Env} env
 * @param {string} projectId
 */
export function overviewStatements(env, projectId) {
  const dashboardId = randomId('dsh');
  return [
    // Only when the project has no dashboard yet: a second concurrent attempt inserts nothing, its chart
    // inserts then fail their foreign key and the whole batch rolls back.
    env.DB.prepare(
      `INSERT INTO dashboards (id, project_id, name, created_at)
       SELECT ?, ?, 'Overview', ? WHERE NOT EXISTS (SELECT 1 FROM dashboards WHERE project_id = ?)`,
    ).bind(dashboardId, projectId, Date.now(), projectId),
    ...STARTER_CHARTS.map(
      ({ where, ...c }) => insertChart(env, dashboardId, { ...c, filter: { where } }).stmt,
    ),
  ];
}

/** @param {import('../types.js').RouteContext} c */
export async function listViews({ env, params }) {
  const project = await findProject(env, params.id);
  const { results } = await env.DB.prepare(
    'SELECT id, project_id, name, filter_json, created_at FROM saved_views WHERE project_id = ? ORDER BY created_at',
  )
    .bind(project.id)
    .all();
  return json({ views: results.map(chartOut) });
}

/** @param {import('../types.js').RouteContext} c */
export async function createView({ request, env, params, user }) {
  const project = await findProject(env, params.id);
  const body = asObject(await readJson(request));
  const name = requireString(body.name, 'name', { max: 60 });
  const filter = parseStoredFilter(body.filter, true);
  const view = { id: randomId('viw'), project_id: project.id, name, filter, created_at: Date.now() };
  await env.DB.prepare(
    'INSERT INTO saved_views (id, project_id, name, filter_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(view.id, project.id, name, JSON.stringify(filter), user?.id ?? null, view.created_at)
    .run();
  return json({ view }, 201);
}

/** @param {import('../types.js').RouteContext} c */
export async function deleteView({ env, params }) {
  const res = await env.DB.prepare('DELETE FROM saved_views WHERE id = ?').bind(params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'View not found');
  return json({ ok: true });
}

/** @param {import('../types.js').RouteContext} c */
export async function listDashboards({ env, params }) {
  const project = await findProject(env, params.id);
  const list = () =>
    env.DB.prepare(
      'SELECT id, project_id, name, created_at FROM dashboards WHERE project_id = ? ORDER BY created_at',
    )
      .bind(project.id)
      .all();
  let { results } = await list();
  // A project always has a dashboard: if the last one was deleted, bring back Overview with its starter charts.
  if (!results.length) {
    // A concurrent request may win the race and make this batch roll back; that's fine if Overview now exists.
    const failure = await env.DB.batch(overviewStatements(env, String(project.id))).then(
      () => null,
      (/** @type {unknown} */ err) => err,
    );
    ({ results } = await list());
    if (!results.length && failure) throw failure;
  }
  return json({ dashboards: results });
}

/** @param {import('../types.js').RouteContext} c */
export async function createDashboard({ request, env, params }) {
  const project = await findProject(env, params.id);
  const body = asObject(await readJson(request));
  const name = requireString(body.name, 'name', { max: 60 });
  const dashboard = { id: randomId('dsh'), project_id: project.id, name, created_at: Date.now() };
  await env.DB.prepare('INSERT INTO dashboards (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(dashboard.id, project.id, name, dashboard.created_at)
    .run();
  return json({ dashboard }, 201);
}

/** @param {import('../types.js').RouteContext} c */
export async function getDashboard({ env, params }) {
  const dashboard = await findDashboard(env, params.id);
  const { results } = await env.DB.prepare(
    `${CHART_SELECT} WHERE c.dashboard_id = ? ORDER BY c.position, c.created_at`,
  )
    .bind(dashboard.id)
    .all();
  return json({ dashboard, charts: results.map(chartOut) });
}

/** @param {import('../types.js').RouteContext} c */
export async function renameDashboard({ request, env, params }) {
  const dashboard = await findDashboard(env, params.id);
  const name = requireString(asObject(await readJson(request)).name, 'name', { max: 60 });
  await env.DB.prepare('UPDATE dashboards SET name = ? WHERE id = ?').bind(name, dashboard.id).run();
  return json({ dashboard: { ...dashboard, name } });
}

/** @param {import('../types.js').RouteContext} c */
export async function deleteDashboard({ env, ctx, params }) {
  const dashboard = await findDashboard(env, params.id);
  const send = await closeBeforeDelete(env, 'c.dashboard_id', String(dashboard.id));
  await env.DB.prepare('DELETE FROM dashboards WHERE id = ?').bind(dashboard.id).run();
  ctx.waitUntil(send());
  return json({ ok: true });
}

/** @param {import('../types.js').RouteContext} c */
export async function createChart({ request, env, params }) {
  const dashboard = await findDashboard(env, params.id);
  const chart = parseChart(asObject(await readJson(request)));
  const { id, stmt } = insertChart(env, String(dashboard.id), chart);
  await stmt.run();
  return json({ chart: await findChart(env, id) }, 201);
}

/** @param {import('../types.js').RouteContext} c */
export async function updateChart({ request, env, params }) {
  const prev = await findChart(env, params.id);
  const c = parseChart(asObject(await readJson(request)), prev);
  await env.DB.prepare(
    'UPDATE charts SET title = ?, filter_json = ?, field = ?, measure = ?, viz = ?, size = ? WHERE id = ?',
  )
    .bind(c.title, JSON.stringify(c.filter), c.field, c.measure, c.viz, c.size, prev.id)
    .run();
  return json({ chart: await findChart(env, String(prev.id)) });
}

/** @param {import('../types.js').RouteContext} c */
export async function duplicateChart({ env, params }) {
  const prev = await findChart(env, params.id);
  const copy = parseChart({ ...prev, title: `${String(prev.title).slice(0, 93)} (copy)` });
  const { id, stmt } = insertChart(env, String(prev.dashboard_id), copy);
  await stmt.run();
  return json({ chart: await findChart(env, id) }, 201);
}

/** @param {import('../types.js').RouteContext} c */
export async function deleteChart({ env, ctx, params }) {
  const send = await closeBeforeDelete(env, 'a.chart_id', params.id);
  const res = await env.DB.prepare('DELETE FROM charts WHERE id = ?').bind(params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Chart not found');
  ctx.waitUntil(send());
  return json({ ok: true });
}
