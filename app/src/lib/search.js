// Search box syntax → structured filter clauses.
//   level:error          =         status:>=500     numeric compare
//   source:api,worker    in        user_id:!u_1     !=
//   code:*               exists    "two words"      free text

const COLUMNS = new Set(['level', 'source', 'message']);
const KEY = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;
const TOKEN = /([^\s:"]+):("[^"]*"|\S+)|"([^"]*)"|(\S+)/g;

/**
 * @typedef {{ field: string, op: string, value?: string | number | boolean | (string | number | boolean)[] }} FieldClause
 */

/** @param {string} key */
export function fieldFor(key) {
  if (COLUMNS.has(key)) return key;
  if (key.startsWith('fields.')) return KEY.test(key.slice(7)) ? key : null;
  return KEY.test(key) && key.length <= 64 ? `fields.${key}` : null;
}

/** @param {string} v */
function scalar(v) {
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

/**
 * @param {string} field
 * @param {string} raw
 * @returns {FieldClause}
 */
function clauseFor(field, raw) {
  const v = raw.startsWith('"') && raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1) : raw;
  if (v === '*') return { field, op: 'exists' };
  const cmp = v.match(/^(>=|<=|>|<)(-?\d+(\.\d+)?)$/);
  if (cmp && field.startsWith('fields.')) return { field, op: cmp[1], value: Number(cmp[2]) };
  const negate = v.startsWith('!');
  const body = negate ? v.slice(1) : v;
  if (body.includes(',')) {
    return { field, op: negate ? 'not_in' : 'in', value: body.split(',').filter(Boolean).map(scalar) };
  }
  return { field, op: negate ? '!=' : '=', value: scalar(body) };
}

/**
 * @param {string} input
 * @returns {{ clauses: FieldClause[], text: string }}
 */
export function parseSearch(input) {
  /** @type {FieldClause[]} */
  const clauses = [];
  const words = [];
  for (const m of input.matchAll(TOKEN)) {
    const isUrl = m[2]?.startsWith('//');
    const field = m[1] && !isUrl ? fieldFor(m[1]) : null;
    if (field && m[2]) clauses.push(clauseFor(field, m[2]));
    else words.push(m[3] ?? m[0]);
  }
  return { clauses, text: words.join(' ').trim() };
}

/** Short label for a chip, e.g. `source = api, worker`. @param {FieldClause} c */
export function clauseLabel(c) {
  const name = c.field.startsWith('fields.') ? c.field.slice(7) : c.field;
  const value = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
  const op = { in: '=', not_in: '≠', '!=': '≠', exists: 'exists', contains: '~' }[c.op] ?? c.op;
  return c.op === 'exists' ? `${name} exists` : `${name} ${op} ${value}`;
}

/** Turns a clause back into search syntax, e.g. `status:>=500`. @param {FieldClause} c */
export function clauseToSearch(c) {
  const name = c.field.startsWith('fields.') ? c.field.slice(7) : c.field;
  const quote = (/** @type {unknown} */ v) =>
    /[\s"]/.test(String(v)) ? `"${String(v).replaceAll('"', '')}"` : String(v);
  if (c.op === 'exists') return `${name}:*`;
  if (c.op === 'in' || c.op === 'not_in') {
    return `${name}:${c.op === 'not_in' ? '!' : ''}${/** @type {unknown[]} */ (c.value).map(quote).join(',')}`;
  }
  const prefix = { '=': '', '!=': '!', '>': '>', '>=': '>=', '<': '<', '<=': '<=' }[c.op] ?? '';
  return `${name}:${prefix}${quote(c.value)}`;
}
