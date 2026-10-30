// Minimal method + path router. Patterns use `:name` segments.

/**
 * @typedef {{ request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, url: URL, user?: import('./auth.js').SessionUser }} RouteContext
 * @typedef {(c: RouteContext) => Promise<Response> | Response} Handler
 */

export class Router {
  constructor() {
    /** @type {{ method: string, parts: string[], handler: Handler }[]} */
    this.routes = [];
  }

  /**
   * @param {string} method
   * @param {string} pattern
   * @param {Handler} handler
   */
  on(method, pattern, handler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  /**
   * @param {string} method
   * @param {string} pathname
   * @returns {{ handler: Handler, params: Record<string, string> } | { allowed: string[] } | null}
   */
  match(method, pathname) {
    const segs = pathname.split('/').filter(Boolean);
    const allowed = [];
    for (const route of this.routes) {
      const params = matchParts(route.parts, segs);
      if (!params) continue;
      if (route.method === method) return { handler: route.handler, params };
      allowed.push(route.method);
    }
    return allowed.length ? { allowed } : null;
  }
}

/**
 * @param {string[]} parts
 * @param {string[]} segs
 */
function matchParts(parts, segs) {
  if (parts.length !== segs.length) return null;
  /** @type {Record<string, string>} */
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      try {
        params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
      } catch {
        return null;
      }
    } else if (parts[i] !== segs[i]) {
      return null;
    }
  }
  return params;
}
