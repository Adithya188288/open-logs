#!/usr/bin/env node
// One-command install into your own Cloudflare account (LOG_STORAGE=local: logs in D1).
//   wrangler login → set ADMIN_PASSWORD → deploy (creates D1) → apply migrations → print URL.
// Basin is optional and needs Workers Paid: run `node scripts/setup-basin.js` afterwards.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * @param {string[]} args
 * @param {{ input?: string, quiet?: boolean }} [opts]
 */
function wrangler(args, opts = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    input: opts.input,
    stdio: opts.input !== undefined || opts.quiet ? 'pipe' : 'inherit',
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function step(/** @type {string} */ label) {
  console.log(`\n→ ${label}`);
}

step('Checking Cloudflare login');
const who = wrangler(['whoami'], { quiet: true });
if (!who.ok || /not authenticated/i.test(who.out)) {
  if (!wrangler(['login']).ok) process.exit(1);
}

step('Deploying the Worker (creates the D1 database on first deploy)');
if (!wrangler(['deploy']).ok) process.exit(1);

step('Applying database migrations');
if (!wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']).ok) process.exit(1);

step('Setting ADMIN_PASSWORD');
const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
if (!wrangler(['secret', 'put', 'ADMIN_PASSWORD'], { input: password }).ok) {
  console.error('Could not set ADMIN_PASSWORD. Run: npx wrangler secret put ADMIN_PASSWORD');
  process.exit(1);
}

console.log(`
Open Logs is deployed.

  Open the workers.dev URL printed above and sign in with any email and this password:

      ${process.env.ADMIN_PASSWORD ? '(the ADMIN_PASSWORD you provided)' : password}

  That first sign-in makes you the owner. ${process.env.ADMIN_PASSWORD ? '' : 'Save the password now: it is not shown again.'}
  Logs are stored in D1. For Basin (cheaper at volume, needs Workers Paid): node scripts/setup-basin.js
`);
