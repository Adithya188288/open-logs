// Web Crypto helpers: ids, tokens, hashing, password storage.

const PBKDF2_ITERATIONS = 100_000; // Workers caps PBKDF2 at 100k iterations.
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** @param {Uint8Array} bytes */
export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** @param {Uint8Array} bytes */
function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {number} n */
export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Random id like `prj_k3j9...` (16 chars, ~82 bits).
 * @param {string} prefix
 */
export function randomId(prefix) {
  const bytes = randomBytes(16);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Source ingest token: `ol_` + 32 random bytes, base64url. */
export function newSourceToken() {
  return `ol_${base64url(randomBytes(32))}`;
}

/**
 * Opaque secret with a prefix, for sessions and invites.
 * @param {string} prefix
 */
export function newSecret(prefix) {
  return `${prefix}${base64url(randomBytes(32))}`;
}

/** @param {string} value */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

/**
 * Constant-time string comparison (length is not secret).
 * @param {string} a
 * @param {string} b
 */
export function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) {
    crypto.subtle.timingSafeEqual(ea, ea);
    return false;
  }
  return crypto.subtle.timingSafeEqual(ea, eb);
}

/**
 * @param {string} password
 * @param {Uint8Array} salt
 */
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

/** @param {string} password */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  return { hash: await pbkdf2(password, salt), salt: hex(salt) };
}

/**
 * @param {string} password
 * @param {string} hash
 * @param {string} saltHex
 */
export async function verifyPassword(password, hash, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
  return timingSafeEqual(await pbkdf2(password, salt), hash);
}
