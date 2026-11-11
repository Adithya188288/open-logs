#!/usr/bin/env node
// npm run demo-data [install]: fills an install with believable sample data, for screenshots and demos.
//   A project "acme-shop" with four services (api, checkout, worker, web), about 20,000 logs over the last 24 hours
//   (with an error spike an hour ago and a fresh burst of checkout errors), a "Checkout" dashboard and an alert.
// Signs in with OPEN_LOGS_EMAIL / OPEN_LOGS_PASSWORD (from .dev.vars); the first sign-in creates the owner.
// Optional: DEMO_WEBHOOK_URL for the alert's webhook.
import { givenName, loadDevVars, loadState } from './lib.js';

loadDevVars();
const state = await loadState(givenName());
const base = state.url;
const email = process.env.OPEN_LOGS_EMAIL;
const password = process.env.OPEN_LOGS_PASSWORD;
if (!base || !email || !password) {
  console.error('Needs the install URL and OPEN_LOGS_EMAIL / OPEN_LOGS_PASSWORD (see .dev.vars.example).');
  process.exit(1);
}

let cookie = '';
/** @param {string} method @param {string} path @param {unknown} [body] */
async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { origin: base, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const HOUR = 3_600_000;
const pick = (/** @type {any[]} */ xs) => xs[Math.floor(Math.random() * xs.length)];
const between = (/** @type {number} */ lo, /** @type {number} */ hi) =>
  Math.round(lo + Math.random() * (hi - lo));

/** One realistic log for a service at time ts. @param {string} service @param {number} ts @param {boolean} spike */
function logFor(service, ts, spike) {
  const user = `u_${between(1000, 9999)}`;
  if (service === 'api') {
    const route = pick(['/v1/orders', '/v1/products', '/v1/cart', '/v1/users/me', '/v1/search']);
    const method =
      route === '/v1/cart' ? pick(['GET', 'POST', 'DELETE']) : pick(['GET', 'GET', 'GET', 'POST']);
    const slow = Math.random() < (spike ? 0.25 : 0.04);
    const status =
      Math.random() < (spike ? 0.18 : 0.02) ? pick([500, 502, 503]) : pick([200, 200, 200, 201, 404]);
    const duration_ms = slow ? between(900, 3200) : between(8, 240);
    const level = status >= 500 ? 'error' : slow ? 'warn' : 'info';
    return {
      ts,
      level,
      message: `${method} ${route} ${status} ${duration_ms}ms`,
      route,
      method,
      status,
      duration_ms,
      user_id: user,
    };
  }
  if (service === 'checkout') {
    const order_id = between(40000, 49999);
    const amount = between(9, 480);
    if (Math.random() < (spike ? 0.3 : 0.05)) {
      const code = pick(['card_declined', 'insufficient_funds', 'gateway_timeout']);
      return {
        ts,
        level: 'error',
        message: `payment failed: ${code}`,
        order_id,
        amount,
        code,
        provider: pick(['stripe', 'adyen']),
      };
    }
    return pick([
      { ts, level: 'info', message: 'order placed', order_id, amount, items: between(1, 6) },
      {
        ts,
        level: 'info',
        message: 'payment captured',
        order_id,
        amount,
        provider: pick(['stripe', 'adyen']),
      },
      { ts, level: 'info', message: 'order shipped', order_id, carrier: pick(['ups', 'dhl', 'fedex']) },
    ]);
  }
  if (service === 'worker') {
    const queue = pick(['emails', 'invoices', 'thumbnails', 'search-index']);
    const duration_ms = between(20, 1800);
    if (Math.random() < (spike ? 0.12 : 0.03)) {
      return {
        ts,
        level: 'error',
        message: `job failed: ${queue} (retrying)`,
        queue,
        attempt: between(1, 3),
      };
    }
    return {
      ts,
      level: duration_ms > 1500 ? 'warn' : 'info',
      message: `job done: ${queue} in ${duration_ms}ms`,
      queue,
      duration_ms,
    };
  }
  const path = pick(['/', '/products', '/products/sneakers', '/cart', '/checkout', '/account']);
  return {
    ts,
    level: Math.random() < 0.01 ? 'warn' : 'info',
    message: `page view ${path}`,
    path,
    country: pick(['US', 'IN', 'DE', 'GB', 'BR', 'JP']),
    device: pick(['desktop', 'mobile', 'mobile']),
    duration_ms: between(120, 2400),
  };
}

console.log(`Filling ${state.name} (${base})`);
await api('POST', '/api/auth/login', { email, password });
await api('PATCH', '/api/settings', { team_name: 'Acme' });

const { projects } = await api('GET', '/api/projects');
let project = projects.find((/** @type {any} */ p) => p.name === 'acme-shop');
if (!project) ({ project } = await api('POST', '/api/projects', { name: 'acme-shop' }));
for (const p of projects) if (p.name === 'Default') await api('DELETE', `/api/projects/${p.id}`);

/** @type {Record<string, string>} */
const tokens = {};
const existing = (await api('GET', `/api/projects/${project.id}/sources`)).sources;
for (const name of ['api', 'checkout', 'worker', 'web']) {
  const old = existing.find((/** @type {any} */ s) => s.name === name);
  tokens[name] = old
    ? (await api('POST', `/api/sources/${old.id}/regenerate`)).token
    : (await api('POST', `/api/projects/${project.id}/sources`, { name })).token;
}

// About 20,000 logs over the last 23 hours (busier in the daytime), an error spike an hour ago, and a burst of
// checkout errors in the last few minutes so the alert opens an incident.
const now = Date.now();
const weights = { api: 0.45, web: 0.3, checkout: 0.15, worker: 0.1 };
/** @type {Record<string, object[]>} */
const batches = { api: [], checkout: [], worker: [], web: [] };
for (let i = 0; i < 20_000; i++) {
  const ts = now - Math.random() * 23 * HOUR - 2 * 60_000;
  const spike = ts > now - 75 * 60_000 && ts < now - 55 * 60_000;
  const r = Math.random();
  let acc = 0;
  let service = 'api';
  for (const [s, w] of Object.entries(weights)) {
    acc += w;
    if (r <= acc) {
      service = s;
      break;
    }
  }
  batches[service].push(logFor(service, Math.round(ts), spike));
}
for (let i = 0; i < 60; i++) {
  batches.checkout.push({
    ts: now - between(60_000, 9 * 60_000),
    level: 'error',
    message: 'payment failed: gateway_timeout',
    order_id: between(40000, 49999),
    amount: between(9, 480),
    code: 'gateway_timeout',
    provider: 'stripe',
  });
}
let sent = 0;
for (const [service, logs] of Object.entries(batches)) {
  for (let i = 0; i < logs.length; i += 1000) {
    const res = await fetch(`${base}/v1/logs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens[service]}`, 'content-type': 'application/json' },
      body: JSON.stringify(logs.slice(i, i + 1000)),
    });
    if (res.status !== 202) throw new Error(`ingest ${service} → ${res.status} ${await res.text()}`);
    sent += logs.slice(i, i + 1000).length;
  }
}
console.log(`  • ${sent} logs sent to api, checkout, worker, web`);

// A "Checkout" dashboard with an alert on its errors chart.
const { dashboards } = await api('GET', `/api/projects/${project.id}/dashboards`);
let board = dashboards.find((/** @type {any} */ d) => d.name === 'Checkout');
if (!board)
  ({ dashboard: board } = await api('POST', `/api/projects/${project.id}/dashboards`, { name: 'Checkout' }));
const { charts } = await api('GET', `/api/dashboards/${board.id}`);
if (!charts.length) {
  const add = (/** @type {object} */ c) => api('POST', `/api/dashboards/${board.id}/charts`, c);
  const checkout = { field: 'source', op: '=', value: 'checkout' };
  const { chart: errors } = await add({
    title: 'Checkout errors',
    filter: { where: [checkout, { field: 'level', op: '=', value: 'error' }] },
    measure: 'count',
    viz: 'number',
    size: 'sm',
  });
  await add({
    title: 'Orders placed',
    filter: { where: [checkout, { text: 'order placed' }] },
    measure: 'count',
    viz: 'number',
    size: 'sm',
  });
  await add({
    title: 'Average order value',
    filter: { where: [checkout] },
    field: 'fields.amount',
    measure: 'avg',
    viz: 'number',
    size: 'sm',
  });
  await add({
    title: 'Payment failures by code',
    filter: { where: [checkout, { field: 'level', op: '=', value: 'error' }] },
    field: 'fields.code',
    measure: 'count',
    viz: 'pie',
    size: 'md',
  });
  await add({
    title: 'API latency p95',
    filter: { where: [{ field: 'source', op: '=', value: 'api' }] },
    field: 'fields.duration_ms',
    measure: 'p95',
    viz: 'line',
    size: 'lg',
  });
  await api('PUT', `/api/charts/${errors.id}/alert`, {
    name: 'Checkout errors spike',
    kind: 'above',
    threshold: 20,
    window_minutes: 15,
    webhook_url: process.env.DEMO_WEBHOOK_URL || 'https://example.com/hooks/open-logs',
  });
}
console.log(`✓ Done. Logs are searchable in 1.5–3.5 minutes; the alert opens an incident a few minutes later.
  ${base}/dashboard?project=${project.id}`);
