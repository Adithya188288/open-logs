// Fetch wrapper for /api. Redirects to sign-in when the session is gone.

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {{ code?: string, message?: string, hint?: string }} body
   */
  constructor(status, body) {
    super(body.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body.code ?? 'error';
    this.hint = body.hint;
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, redirectOn401?: boolean }} [opts]
 */
export async function api(path, opts = {}) {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await fetch(path, {
    method,
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && opts.redirectOn401 !== false) {
    const next = location.pathname + location.search;
    location.href = `/login?next=${encodeURIComponent(next)}`;
    throw new ApiError(401, data.error ?? {});
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? {});
  return data;
}
