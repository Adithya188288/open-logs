// Small HTTP helpers shared by every route.

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {unknown} data
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function json(data, status = 200, headers) {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

/** @param {HttpError} err */
export function errorResponse(err) {
  return json({ error: { code: err.code, message: err.message, ...err.details } }, err.status);
}

/**
 * Reads a JSON body, enforcing a byte limit while streaming.
 * @param {Request} request
 * @param {number} [maxBytes]
 */
export async function readJson(request, maxBytes = 64 * 1024) {
  const text = await readText(request, maxBytes);
  if (!text) throw new HttpError(400, 'invalid_json', 'Request body must be JSON');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

/**
 * @param {Request} request
 * @param {number} maxBytes
 */
export async function readText(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** @param {number} maxBytes */
function tooLarge(maxBytes) {
  return new HttpError(413, 'payload_too_large', `Request body is larger than ${maxBytes} bytes`);
}

/**
 * Asserts the value is a plain object (parsed JSON body).
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {{ min?: number, max?: number, pattern?: RegExp }} [rules]
 */
export function requireString(value, name, rules = {}) {
  const { min = 1, max = 200, pattern } = rules;
  if (typeof value !== 'string')
    throw new HttpError(400, 'invalid_field', `${name} is required`, { field: name });
  const v = value.trim();
  if (v.length < min || v.length > max || (pattern && !pattern.test(v))) {
    throw new HttpError(400, 'invalid_field', `${name} is invalid`, { field: name });
  }
  return v;
}

/**
 * A password, kept exactly as typed: spaces count, so it must never be trimmed.
 * @param {unknown} value
 * @param {string} name
 */
export function requirePassword(value, name) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new HttpError(400, 'invalid_field', `${name} must be 8 to 256 characters`, { field: name });
  }
  return value;
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
