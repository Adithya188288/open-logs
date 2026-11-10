// Projects and their sources (one ingest token per source).
import { closeBeforeDelete } from '../alerts/alerts.js';
import { requireRole } from '../auth.js';
import { newSourceToken, randomId, sha256Hex } from '../crypto.js';
import { asObject, HttpError, json, readJson, requireString } from '../http.js';
import { getStorage } from '../storage/index.js';
import { overviewStatements } from './boards.js';

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const SOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SOURCE_COLUMNS = 'id, project_id, name, token_prefix, created_at, first_event_at, last_rejected_at';
/** Rows per page on the Projects and Sources tables. */
export const PAGE_SIZE = 12;

/**
 * `?page=N` (1-based) asks for one page of a table; without it, the whole list is returned.
 * @param {URL} url
 */
function pageOf(url) {
  const raw = url.searchParams.get('page');
  if (raw === null) return null;
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) throw new HttpError(400, 'invalid_page', 'page must be 1 or more');
  return page;
}

/**
 * @param {Env} env
 * @param {string} id
 */
export async function findProject(env, id) {
  const project = await env.DB.prepare('SELECT id, name, created_at FROM projects WHERE id = ?')
    .bind(id)
    .first();
  if (!project) throw new HttpError(404, 'not_found', 'Project not found');
  return project;
}

/**
 * Runs an insert/update and turns UNIQUE violations into 409s.
 * @param {D1PreparedStatement} stmt
 * @param {string} message
 */
async function runUnique(stmt, message) {
  try {
    return await stmt.run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, 'conflict', message);
    throw err;
  }
}

/**
 * Projects, from D1 only. Without `?page` (sidebar, switcher, start-up): every project with its sources'
 * ids and names. With `?page=N` (the Projects table): 12 projects with their source counts, and the total.
 * @param {import('../types.js').RouteContext} c
 */
export async function listProjects({ env, url }) {
  const page = pageOf(url);
  if (page !== null) {
    // `?find=` narrows the table by name (a substring, any case).
    const find = `%${(url.searchParams.get('find') ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const [rows, total] = await env.DB.batch([
      env.DB.prepare(
        `SELECT p.id, p.name, p.created_at, COUNT(s.id) AS source_count
         FROM projects p LEFT JOIN sources s ON s.project_id = p.id
         WHERE p.name LIKE ? ESCAPE '\\'
         GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      ).bind(find, PAGE_SIZE, (page - 1) * PAGE_SIZE),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM projects WHERE name LIKE ? ESCAPE '\\'`).bind(find),
    ]);
    return json({ projects: rows.results, total: total.results[0].n, page, page_size: PAGE_SIZE });
  }
  const [projects, sources] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, created_at FROM projects ORDER BY created_at'),
    env.DB.prepare('SELECT id, project_id, name FROM sources ORDER BY created_at'),
  ]);
  const byProject = Map.groupBy(sources.results, (s) => s.project_id);
  return json({ projects: projects.results.map((p) => ({ ...p, sources: byProject.get(p.id) ?? [] })) });
}

/** @param {import('../types.js').RouteContext} c */
export async function createProject({ request, env }) {
  const body = asObject(await readJson(request));
  const name = requireString(body.name, 'name', { max: 64, pattern: PROJECT_NAME });
  const project = { id: randomId('prj'), name, created_at: Date.now() };
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').bind(
        project.id,
        project.name,
        project.created_at,
      ),
      ...overviewStatements(env, project.id),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE'))
      throw new HttpError(409, 'conflict', 'A project with that name already exists');
    throw err;
  }
  return json({ project }, 201);
}

/** @param {import('../types.js').RouteContext} c */
export async function getProject({ env, params }) {
  const project = await findProject(env, params.id);
  const sources = await env.DB.prepare(
    `SELECT ${SOURCE_COLUMNS} FROM sources WHERE project_id = ? ORDER BY created_at`,
  )
    .bind(project.id)
    .all();
  return json({ project, sources: sources.results });
}

/** @param {import('../types.js').RouteContext} c */
export async function renameProject({ request, env, params }) {
  const project = await findProject(env, params.id);
  const body = asObject(await readJson(request));
  const name = requireString(body.name, 'name', { max: 64, pattern: PROJECT_NAME });
  await runUnique(
    env.DB.prepare('UPDATE projects SET name = ? WHERE id = ?').bind(name, project.id),
    'A project with that name already exists',
  );
  return json({ project: { ...project, name } });
}

/** @param {import('../types.js').RouteContext} c */
export async function deleteProject({ env, ctx, params, user }) {
  requireRole(user, 'admin');
  const project = await findProject(env, params.id);
  const send = await closeBeforeDelete(env, 'a.project_id', String(project.id));
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id).run();
  ctx.waitUntil(send());
  await getStorage(env).deleteProject(project.id);
  return json({ ok: true });
}

/** @param {import('../types.js').RouteContext} c */
export async function listSources({ env, params, url }) {
  const project = await findProject(env, params.id);
  const page = pageOf(url);
  if (page !== null) {
    const [rows, total] = await env.DB.batch([
      env.DB.prepare(
        `SELECT ${SOURCE_COLUMNS} FROM sources WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ).bind(project.id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
      env.DB.prepare('SELECT COUNT(*) AS n FROM sources WHERE project_id = ?').bind(project.id),
    ]);
    return json({ sources: rows.results, total: total.results[0].n, page, page_size: PAGE_SIZE });
  }
  const sources = await env.DB.prepare(
    `SELECT ${SOURCE_COLUMNS} FROM sources WHERE project_id = ? ORDER BY created_at`,
  )
    .bind(project.id)
    .all();
  return json({ sources: sources.results });
}

/** @param {import('../types.js').RouteContext} c */
export async function createSource({ request, env, params }) {
  const project = await findProject(env, params.id);
  const body = asObject(await readJson(request));
  const name = requireString(body.name, 'name', { max: 64, pattern: SOURCE_NAME });
  const token = newSourceToken();
  const source = {
    id: randomId('src'),
    project_id: project.id,
    name,
    token_prefix: token.slice(0, 8),
    created_at: Date.now(),
    first_event_at: null,
    last_rejected_at: null,
  };
  await runUnique(
    env.DB.prepare(
      'INSERT INTO sources (id, project_id, name, token_hash, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(source.id, project.id, name, await sha256Hex(token), source.token_prefix, source.created_at),
    'A source with that name already exists in this project',
  );
  return json({ source, token }, 201);
}

/** @param {import('../types.js').RouteContext} c */
export async function regenerateSource({ env, params }) {
  const token = newSourceToken();
  const res = await env.DB.prepare(
    `UPDATE sources SET prev_token_prefix = token_prefix, token_hash = ?, token_prefix = ?,
       last_rejected_at = NULL WHERE id = ?`,
  )
    .bind(await sha256Hex(token), token.slice(0, 8), params.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Source not found');
  const source = await env.DB.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`)
    .bind(params.id)
    .first();
  return json({ source, token });
}

/** @param {import('../types.js').RouteContext} c */
export async function deleteSource({ env, params, user }) {
  requireRole(user, 'admin');
  const res = await env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(params.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Source not found');
  return json({ ok: true });
}

/** @param {import('../types.js').RouteContext} c */
export async function getSource({ env, params }) {
  const source = await env.DB.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`)
    .bind(params.id)
    .first();
  if (!source) throw new HttpError(404, 'not_found', 'Source not found');
  return json({ source, project: await findProject(env, String(source.project_id)) });
}

/** @param {import('../types.js').RouteContext} c */
export async function renameSource({ request, env, params }) {
  const name = requireString(asObject(await readJson(request)).name, 'name', {
    max: 64,
    pattern: SOURCE_NAME,
  });
  const res = await runUnique(
    env.DB.prepare('UPDATE sources SET name = ? WHERE id = ?').bind(name, params.id),
    'A source with that name already exists in this project',
  );
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Source not found');
  const source = await env.DB.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`)
    .bind(params.id)
    .first();
  return json({ source });
}
