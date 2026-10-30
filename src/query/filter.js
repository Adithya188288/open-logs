// Validates the structured filter clients send. Clients never send SQL.
import { HttpError } from '../http.js';

export const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 100;
const MAX_CLAUSES = 20;
const MAX_IN_VALUES = 50;
const TEXT_SEARCH_WIDE_MS = 24 * 60 * 60 * 1000;
const FIELD_KEY = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;
const COLUMNS = new Set(['level', 'source', 'message']);
const OPS = new Set(['=', '!=', 'in', 'not_in', '>', '>=', '<', '<=', 'contains', 'exists']);
const RANGE_OPS = new Set(['>', '>=', '<', '<=']);
const INTERVALS = [1, 5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 10800, 21600, 43200, 86400].map(
  (s) => s * 1000,
);

/**
 * @typedef {{ field: string, op: string, value?: string | number | boolean | (string | number | boolean)[] }} FieldClause
 * @typedef {{ text: string }} TextClause
 * @typedef {FieldClause | TextClause} Clause
 * @typedef {{ project_id: string, from: number, to: number, where: Clause[], limit: number, cursor: { ts: number, id: string } | null }} Filter
 */

/** @param {string} message */
function bad(message) {
  return new HttpError(400, 'invalid_filter', message);
}

/**
 * Checks a field reference: `level`, `source`, `message` or `fields.<key>`.
 * @param {unknown} field
 * @returns {string}
 */
export function parseField(field) {
  if (typeof field !== 'string') throw bad('field must be a string');
  if (COLUMNS.has(field)) return field;
  if (field.startsWith('fields.')) {
    const key = field.slice(7);
    if (key.length <= 64 && FIELD_KEY.test(key)) return field;
  }
  throw bad(`Unknown field "${field.slice(0, 80)}"`);
}

/** @param {unknown} v */
function scalar(v) {
  if (typeof v === 'string' && v.length <= 500) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  throw bad('Filter values must be strings (≤500 chars), numbers or booleans');
}

/**
 * @param {unknown} raw
 * @returns {Clause}
 */
function parseClause(raw) {
  if (!raw || typeof raw !== 'object') throw bad('Each where clause must be an object');
  const c = /** @type {Record<string, unknown>} */ (raw);
  if ('text' in c) {
    if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 200)
      throw bad('text must be 1-200 chars');
    return { text: c.text.trim() };
  }
  const field = parseField(c.field);
  const op = typeof c.op === 'string' && OPS.has(c.op) ? c.op : null;
  if (!op) throw bad('Unsupported operator');
  if (op === 'exists') return { field, op };
  if (op === 'in' || op === 'not_in') {
    if (!Array.isArray(c.value) || c.value.length === 0 || c.value.length > MAX_IN_VALUES) {
      throw bad(`${op} needs 1-${MAX_IN_VALUES} values`);
    }
    return { field, op, value: c.value.map(scalar) };
  }
  const value = scalar(c.value);
  if (RANGE_OPS.has(op) && !Number.isFinite(Number(value))) throw bad(`${op} needs a number`);
  if (RANGE_OPS.has(op) && !field.startsWith('fields.')) throw bad(`${op} only applies to fields.*`);
  return { field, op, value };
}

/**
 * @param {unknown} body
 * @returns {Filter}
 */
export function parseFilter(body) {
  if (!body || typeof body !== 'object') throw bad('Filter must be an object');
  const b = /** @type {Record<string, unknown>} */ (body);
  if (typeof b.project_id !== 'string' || !b.project_id) throw bad('project_id is required');
  const from = Number(b.from);
  const to = Number(b.to);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to) {
    throw bad('from and to are required (unix ms, from < to)');
  }
  if (to - from > MAX_RANGE_MS) throw bad('Time range is limited to 7 days');
  const rawWhere = b.where ?? [];
  if (!Array.isArray(rawWhere) || rawWhere.length > MAX_CLAUSES)
    throw bad(`where must be a list of ≤${MAX_CLAUSES}`);
  const where = rawWhere.map(parseClause);
  const limitIn = b.limit === undefined ? DEFAULT_LIMIT : Number(b.limit);
  if (!Number.isFinite(limitIn) || limitIn < 1) throw bad('limit must be a positive number');
  const cursor = b.cursor ? decodeCursor(b.cursor) : null;

  const hasText = where.some((c) => 'text' in c);
  const narrowed = where.some((c) => 'field' in c && ['=', 'in'].includes(c.op));
  if (hasText && !narrowed && to - from > TEXT_SEARCH_WIDE_MS) {
    throw new HttpError(422, 'query_too_large', 'This search would scan too much data', {
      hint: 'Narrow the time range to 24h or less, or add a field filter like level:error.',
    });
  }
  return {
    project_id: b.project_id,
    from,
    to,
    where,
    limit: Math.min(Math.floor(limitIn), MAX_LIMIT),
    cursor,
  };
}

/** @param {{ ts: number, id: string }} c */
export function encodeCursor(c) {
  return btoa(JSON.stringify([c.ts, c.id])).replaceAll('=', '');
}

/** @param {unknown} raw */
export function decodeCursor(raw) {
  try {
    const [ts, id] = JSON.parse(atob(String(raw)));
    if (Number.isSafeInteger(ts) && typeof id === 'string' && id.length <= 64) return { ts, id };
  } catch {}
  throw bad('Invalid cursor');
}

/**
 * Picks a "nice" bucket size giving roughly `target` buckets.
 * @param {number} from
 * @param {number} to
 * @param {number} [target]
 */
export function pickInterval(from, to, target = 60) {
  const ideal = (to - from) / target;
  return INTERVALS.find((i) => i >= ideal) ?? INTERVALS[INTERVALS.length - 1];
}
