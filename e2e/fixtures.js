// Shared Playwright fixtures: theme option, API helpers that use the signed-in session.
import { test as base, expect } from '@playwright/test';

export const ADMIN_EMAIL = 'owner@e2e.test';
export const ADMIN_PASSWORD = 'e2e-admin-password';

/** Unique name per test run and theme, since the server state is shared. */
export function uniq(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

export const test = base.extend({
  theme: ['light', { option: true }],
  page: async ({ page, theme }, use) => {
    await page.addInitScript((t) => {
      if (!sessionStorage.getItem('theme-set')) {
        localStorage.setItem('logs-theme', t);
        sessionStorage.setItem('theme-set', '1');
      }
    }, theme);
    await use(page);
  },
  /** Calls the app API with the page's session cookie. */
  app: async ({ page, baseURL }, use) => {
    const call = async (method, path, data) => {
      const res = await page.request.fetch(path, {
        method,
        data,
        headers: { origin: baseURL },
      });
      expect(res.ok(), `${method} ${path} → ${res.status()}`).toBeTruthy();
      return res.json();
    };
    await use({
      get: (path) => call('GET', path),
      post: (path, data) => call('POST', path, data ?? {}),
      /** Creates a project with one source; returns { project, source, token }. */
      async projectWithSource(projectName = uniq('shop'), sourceName = 'api') {
        const { project } = await call('POST', '/api/projects', { name: projectName });
        const { source, token } = await call('POST', `/api/projects/${project.id}/sources`, {
          name: sourceName,
        });
        return { project, source, token };
      },
      /** Sends events to /v1/logs with a source token. */
      async send(token, events) {
        const res = await page.request.post('/v1/logs', {
          data: events,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status()).toBe(202);
      },
    });
  },
});

/** Realistic sample events ending `now`, newest last. */
export function sampleEvents(now = Date.now(), n = 40) {
  const kinds = [
    ['info', 'GET /health 200 3ms', { route: '/health', status: 200, duration_ms: 3 }],
    ['info', 'POST /checkout 200 182ms', { route: '/checkout', status: 200, duration_ms: 182 }],
    ['error', 'payment failed: card_declined', { order_id: 4821, code: 'card_declined' }],
    ['warn', 'slow query on orders took 1402ms', { table: 'orders', duration_ms: 1402 }],
    ['error', 'POST /checkout 500 upstream timeout', { route: '/checkout', status: 500, duration_ms: 10000 }],
  ];
  return Array.from({ length: n }, (_, i) => {
    const [level, message, fields] = kinds[i % kinds.length];
    return { ts: now - (n - i) * 5000, level, message, ...fields };
  });
}

export { expect };
