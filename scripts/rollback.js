#!/usr/bin/env node
// npm run rollback [-- --name my-logs]: puts the previous Worker version back (Cloudflare keeps them).
// The database is not rolled back: releases only add to it, so the older Worker still works with it.
import { loadState, step, wrangler } from './lib.js';

const state = await loadState();
process.env.CLOUDFLARE_ACCOUNT_ID = state.accountId;

step(`Rolling back "${state.name}" to its previous version`);
const r = wrangler(['rollback', '--name', state.name, '--yes', '--message', 'npm run rollback']);
if (!r.ok) process.exit(1);
console.log(`
✓ The previous version is live again at ${state.url}

  If an update also damaged app data (users, projects, dashboards), D1 can restore the database to any
  minute in the last 30 days:
    npx wrangler d1 time-travel restore ${state.database} --timestamp=<ISO time before the update>
  Logs in Basin are never changed by an update.
`);
