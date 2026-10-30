// Turns whatever JSON a client sends into the stored event shape.

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_KEYS = ['ts', 'timestamp', 'dt'];
const LEVEL_KEYS = ['level', 'severity'];
const MESSAGE_KEYS = ['message', 'msg'];
// Set by the server from the token; dropped from the body so they can't be spoofed.
const SERVER_KEYS = ['project_id', 'source'];
const RESERVED = new Set([...TIME_KEYS, ...LEVEL_KEYS, ...MESSAGE_KEYS, ...SERVER_KEYS]);

/** @type {Record<string, 'debug' | 'info' | 'warn' | 'error' | 'fatal'>} */
const LEVEL_NAMES = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  information: 'info',
  notice: 'info',
  log: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  alert: 'fatal',
  emerg: 'fatal',
  emergency: 'fatal',
  panic: 'fatal',
};

/**
 * Maps names (any case) and pino-style numbers (10-60) to debug|info|warn|error|fatal.
 * @param {unknown} raw
 */
export function normalizeLevel(raw) {
  if (typeof raw === 'number') {
    if (raw >= 60) return 'fatal';
    if (raw >= 50) return 'error';
    if (raw >= 40) return 'warn';
    if (raw >= 30) return 'info';
    return 'debug';
  }
  if (typeof raw === 'string') return LEVEL_NAMES[raw.trim().toLowerCase()] ?? 'info';
  return 'info';
}

/**
 * Client time if it parses and is within ±24h of now; ms, seconds and ISO strings are accepted.
 * @param {unknown} raw
 * @param {number} now
 */
function normalizeTime(raw, now) {
  let ms = Number.NaN;
  if (typeof raw === 'number') ms = raw < 1e11 ? raw * 1000 : raw;
  else if (typeof raw === 'string' && raw) ms = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(ms) || Math.abs(ms - now) > DAY_MS) return now;
  return Math.round(ms);
}

/**
 * Time-sortable id: 12 hex chars of ms timestamp + 8 random base36 chars.
 * @param {number} ts
 */
function eventId(ts) {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  let tail = '';
  for (const b of rand) tail += (b % 36).toString(36);
  return ts.toString(16).padStart(12, '0') + tail;
}

/**
 * @param {Record<string, unknown>} body
 * @param {string[]} keys
 */
function pick(body, keys) {
  for (const k of keys) if (body[k] !== undefined && body[k] !== null) return body[k];
  return undefined;
}

/**
 * @param {Record<string, unknown>} body  one event object from the request
 * @param {{ project_id: string, name: string }} source  resolved from the token
 * @param {number} now
 * @returns {import('../storage/index.js').StoredEvent}
 */
export function normalizeEvent(body, source, now) {
  const ts = normalizeTime(pick(body, TIME_KEYS), now);
  const rawMessage = pick(body, MESSAGE_KEYS);
  const message =
    rawMessage === undefined ? '' : typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
  /** @type {Record<string, unknown>} */
  const fields = {};
  for (const [k, v] of Object.entries(body)) if (!RESERVED.has(k)) fields[k] = v;
  return {
    id: eventId(ts),
    ts,
    project_id: source.project_id,
    source: source.name,
    level: normalizeLevel(pick(body, LEVEL_KEYS)),
    message,
    fields: JSON.stringify(fields),
  };
}
