// Projects and their sources (one ingest token per source).
import { requireRole } from '../auth.js';
import { newSourceToken, randomId, sha256Hex } from '../crypto.js';
import { asObject, HttpError, json, readJson, requireString } from '../http.js';
import { getStorage } from '../storage/index.js';
import { overviewStatements } from './boards.js';

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const SOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SOURCE_COLUMNS =
  'id, project_id, name, token_prefix, created_at, last_event_at, rejected_count, last_rejected_at';

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

/** @param {import('../types.js').RouteContext} c */
export async function listProjects({ env }) {
  const [projects, sources] = await Promise.all([
    env.DB.prepare('SELECT id, name, created_at FROM projects ORDER BY created_at').all(),
    env.DB.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY created_at`).all(),
  ]);
  const byProject = Map.groupBy(sources.results, (s) => s.project_id);
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const to = Math.ceil(now / hour) * hour;
  const ids = projects.results.map((p) => String(p.id));
  const stats = await getStorage(env).overview(ids, to - 24 * hour, to, hour);
  return json({
    projects: projects.results.map((p) => {
      const own = byProject.get(p.id) ?? [];
      const lastEvent = Math.max(0, ...own.map((s) => Number(s.last_event_at ?? 0)));
      const s = stats[String(p.id)];
      return {
        ...p,
        sources: own,
        last_event_at: lastEvent || null,
        stats: {
          events_24h: s?.total ?? 0,
          errors_24h: s?.errors ?? 0,
          spark: s?.series ?? new Array(24).fill(0),
        },
      };
    }),
  });
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
export async function deleteProject({ env, params, user }) {
  requireRole(user, 'admin');
  const project = await findProject(env, params.id);
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id).run();
  await getStorage(env).deleteProject(project.id);
  return json({ ok: true });
}

/** @param {import('../types.js').RouteContext} c */
export async function listSources({ env, params }) {
  const project = await findProject(env, params.id);
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
    last_event_at: null,
    rejected_count: 0,
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
       rejected_count = 0, last_rejected_at = NULL WHERE id = ?`,
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
