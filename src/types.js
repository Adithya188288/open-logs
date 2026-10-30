// Shared JSDoc types for route handlers.

/**
 * @typedef {{ request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, url: URL, user?: import('./auth.js').SessionUser }} RouteContext
 * @typedef {(c: RouteContext) => Promise<Response> | Response} Handler
 */

export {};
