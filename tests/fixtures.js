// Shared test helpers: the run id, the seeded data, an API client that uses the signed-in session.
import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';

export const RUN = /** @type {string} */ (process.env.E2E_RUN);
export const OWNER_EMAIL = /** @type {string} */ (process.env.OPEN_LOGS_EMAIL);
export const OWNER_PASSWORD = /** @type {string} */ (process.env.OPEN_LOGS_PASSWORD);
export const SEED_FILE = 'tests/.state/seed.json';

/** A name that belongs to this run. @param {string} what */
export const named = (what) => `e2e-${RUN}-${what}`;

/**
 * What seed.setup.js created: one project with two sources and the logs sent to them.
 * @typedef {{ projectId: string, sentAt: number, sources: Record<'api' | 'worker', { id: string, token: string, sent: number }>, errors: number }} Seed
 * @returns {Seed}
 */
export const seed = () => JSON.parse(readFileSync(SEED_FILE, 'utf8'));

/**
 * Realistic events ending now, every one tagged with this run. Levels repeat info, info, error, warn, error,
 * so 40 events hold 16 errors.
 * @param {number} n
 */
export function sampleEvents(n) {
  const kinds = [
    ['info', 'GET /health 200 3ms', { route: '/health', status: 200 }],
    ['info', 'POST /checkout 200 182ms', { route: '/checkout', status: 200 }],
    ['error', 'payment failed: card_declined', { code: 'card_declined' }],
    ['warn', 'slow query on orders took 1402ms', { table: 'orders' }],
    ['error', 'POST /checkout 500 upstream timeout', { route: '/checkout', status: 500 }],
  ];
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const [level, message, fields] = kinds[i % kinds.length];
    return { ts: now - (n - i) * 1000, level, message, run: RUN, ...fields };
  });
}

export const test = base.extend({
  /** Calls the app API with the page's session. Fails the test on any non-2xx answer. */
  app: async ({ page, baseURL }, use) => {
    /** @param {string} method @param {string} path @param {unknown} [data] */
    const call = async (method, path, data) => {
      const res = await page.request.fetch(path, { method, data, headers: { origin: String(baseURL) } });
      expect(res.ok(), `${method} ${path} → ${res.status()}`).toBeTruthy();
      return res.json();
    };
    await use({
      /** @param {string} path */
      get: (path) => call('GET', path),
      /** @param {string} path @param {unknown} [data] */
      post: (path, data) => call('POST', path, data ?? {}),
      /** @param {string} path @param {unknown} [data] */
      patch: (path, data) => call('PATCH', path, data ?? {}),
      /** Logs matching `where` in the last hour of a project (newest first). */
      query: (/** @type {string} */ projectId, /** @type {object[]} */ where) =>
        call('POST', '/api/query', {
          project_id: projectId,
          from: Date.now() - 3_600_000,
          to: Date.now() + 60_000,
          where,
          limit: 500,
        }),
    });
  },
});

export { expect };
