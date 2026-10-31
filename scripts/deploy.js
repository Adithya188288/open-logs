#!/usr/bin/env node
// For developers: put the code you have checked out (any branch, uncommitted changes included) on an install.
//   npm run deploy <name>   new D1 migrations, build, deploy.
//   npm run reset <name>    wipes the install's D1 first (users, projects, dashboards), then deploys.
// Logs in Basin are left alone by both.
import {
  applyMigrations,
  ask,
  buildAndDeploy,
  configPath,
  loadState,
  step,
  wrangler,
  writeConfig,
} from './lib.js';

const state = await loadState();
process.env.CLOUDFLARE_ACCOUNT_ID = state.accountId;
const reset = process.argv.includes('--reset');

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
