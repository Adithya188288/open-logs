#!/usr/bin/env node
// Our own test install (a normal install, kept in .open-logs/ like any other), picked with --name.
//   npm run deploy:staging   deploys the current branch there: new D1 migrations, build, deploy.
//   npm run staging:reset    wipes its D1 and redeploys `develop`, for when a branch's migration broke it.
// Logs in Basin are left alone by both.
import { spawnSync } from 'node:child_process';
import {
  applyMigrations,
  buildAndDeploy,
  configPath,
  loadState,
  step,
  wrangler,
  writeConfig,
} from './lib.js';

const state = await loadState();
process.env.CLOUDFLARE_ACCOUNT_ID = state.accountId;
const reset = process.argv[2] === 'reset';

if (reset) {
  const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim();
  if (branch !== 'develop') {
    console.error(
      `staging:reset rebuilds staging from develop. Switch first: git switch develop (now on ${branch}).`,
    );
    process.exit(1);
  }
  step(`Wiping ${state.database} (D1)`);
  const listed = wrangler(
    [
      'd1',
      'execute',
      'DB',
      '--remote',
      '--json',
      '-c',
      configPath(state.name),
      '--command',
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ],
    { quiet: true },
  );
  if (!listed.ok) {
    console.error(listed.out);
    process.exit(1);
  }
  const tables = JSON.parse(listed.out)[0].results.map((/** @type {{ name: string }} */ r) => r.name);
  const drop = ['PRAGMA defer_foreign_keys = on', ...tables.map((t) => `DROP TABLE IF EXISTS "${t}"`)].join(
    '; ',
  );
  if (
    tables.length &&
    !wrangler(['d1', 'execute', 'DB', '--remote', '-c', configPath(state.name), '--command', drop], {
      quiet: true,
    }).ok
  ) {
    console.error('  Could not drop the tables.');
    process.exit(1);
  }
  console.log(`  • dropped ${tables.length} tables`);
}

step(`Deploying to ${state.name}`);
writeConfig(state);
applyMigrations(state.name);
buildAndDeploy(state.name);
console.log(
  `\n✓ ${state.url}${reset ? '\n  The database is empty: the first sign-in with ADMIN_PASSWORD creates the owner again.' : ''}`,
);
