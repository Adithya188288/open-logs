// Every log carries its source's id, which never changes, plus the source's name when it arrived.
// People filter and group by source *name*; these helpers turn names into ids for the query, and ids back
// into today's names for the response. So renaming a source keeps its history, and a new source that
// reuses a deleted source's name never picks up the old logs.

/** Matches no real source id (ids look like `src_…`). */
const NO_SOURCE = '-';

/**
 * Current names of a project's sources, by id.
 * @param {Env} env
 * @param {string} projectId
 * @returns {Promise<Map<string, string>>}
 */
export async function sourceNames(env, projectId) {
  const { results } = await env.DB.prepare('SELECT id, name FROM sources WHERE project_id = ?')
    .bind(projectId)
    .all();
  return new Map(results.map((r) => [String(r.id), String(r.name)]));
}

/**
 * Rewrites `source` clauses (by name) into `source_id` clauses. Unknown names match nothing.
 * @param {import('./filter.js').Filter} filter
 * @param {Map<string, string>} names  id → name
 * @returns {import('./filter.js').Filter}
 */
export function bySourceId(filter, names) {
  /** @type {Map<string, string>} */
  const idOf = new Map([...names].map(([id, name]) => [name, id]));
  const toId = (/** @type {unknown} */ name) => idOf.get(String(name)) ?? NO_SOURCE;
  const where = filter.where.map((clause) => {
    if (!('field' in clause) || clause.field !== 'source' || clause.op === 'exists') return clause;
    if (clause.op === 'contains') {
      const needle = String(clause.value).toLowerCase();
      const ids = [...names].filter(([, name]) => name.toLowerCase().includes(needle)).map(([id]) => id);
      return { field: 'source_id', op: 'in', value: ids.length ? ids : [NO_SOURCE] };
    }
    const value = Array.isArray(clause.value) ? clause.value.map(toId) : toId(clause.value);
    return { field: 'source_id', op: clause.op, value };
  });
  return { ...filter, where };
}

/**
 * Today's name for a source id; events from a since-deleted source keep the name they arrived with.
 * @param {Map<string, string>} names
 * @param {string} id
 * @param {string} fallback
 */
export function nameOf(names, id, fallback) {
  return names.get(id) ?? fallback;
}
