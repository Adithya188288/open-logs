#!/usr/bin/env node
// For developers: put the code you have checked out (uncommitted changes included) on an install.
//   npm run deploy          the branch's own install, open-logs-<branch>; created the first time (setup), using
//                           OPEN_LOGS_TOKEN, OPEN_LOGS_EMAIL and OPEN_LOGS_PASSWORD from .dev.vars.
//   npm run deploy <name>   a named install: new D1 migrations, build, deploy.
//   npm run reset <name>    wipes the install's D1 first (users, projects, dashboards), then deploys.
// Logs in Basin are left alone by all of them.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  applyMigrations,
  ask,
  branchInstall,
  buildAndDeploy,
  configPath,
  givenName,
  INSTALLS_DIR,
  loadDevVars,
  loadState,
  step,
  wrangler,
  writeConfig,
} from './lib.js';

const reset = process.argv.includes('--reset');
const name = givenName() ?? (reset ? undefined : branchInstall());

if (name && !givenName() && !existsSync(`${INSTALLS_DIR}/${name}.json`)) {
  loadDevVars();
  step(`Creating ${name}, the install for this branch`);
  const setup = spawnSync('node', ['scripts/setup.js', name], { stdio: 'inherit' });
  process.exit(setup.status ?? 1);
}

const state = await loadState(name);
process.env.CLOUDFLARE_ACCOUNT_ID = state.accountId;

if (reset) {
  console.log(`\nThis deletes all app data in "${state.name}": users, projects, sources, dashboards.`);
  if ((await ask(`  Type "${state.name}" to confirm: `)) !== state.name) {
    console.log('  Not confirmed. Nothing changed.');
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
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid",
    ],
    { quiet: true },
  );
  if (!listed.ok) {
    console.error(listed.out);
    process.exit(1);
  }
  const tables = JSON.parse(listed.out)[0].results.map((/** @type {{ name: string }} */ r) => r.name);
  // Newest table first: sqlite_master lists tables in the order they were created, so children (sources,
  // charts, incidents…) go before the parents they point at. D1 doesn't apply a batch that starts with
  // `PRAGMA defer_foreign_keys`, so the order is what keeps foreign keys happy.
  const drop = tables
    .toReversed()
    .map((t) => `DROP TABLE IF EXISTS "${t}"`)
    .join('; ');
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
