#!/usr/bin/env node
// npm run update [-- --name my-logs] [-- --to v0.2.0]: moves an install to the newest release.
//   newest release tag → packages → new D1 migrations only (D1 remembers which ran) → build and deploy → check.
// Releases only add to the database (see CLAUDE.md), so the running Worker keeps working while this runs.
import { spawnSync } from 'node:child_process';
import { checkLogsFlow } from './check.js';
import {
  applyMigrations,
  askHidden,
  buildAndDeploy,
  flag,
  loadState,
  run,
  step,
  writeConfig,
} from './lib.js';

/** @param {string[]} args */
const git = (args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();

const state = loadState();
process.env.CLOUDFLARE_ACCOUNT_ID = state.accountId;

step('Finding the newest release');
if (git(['status', '--porcelain', '--untracked-files=no'])) {
  console.error('  You have local changes to Open Logs files. Commit or discard them first (git status).');
  process.exit(1);
}
if (git(['remote'])) run('git', ['fetch', '--tags', '--quiet']);
const target = flag('to') ?? git(['tag', '--list', 'v*', '--sort=-v:refname']).split('\n')[0];
if (!target) {
  console.error('  No release tags found (v1.2.3).');
  process.exit(1);
}
const current = git(['describe', '--tags', '--exact-match']);
if (current === target) {
  console.log(`  Already on ${target}. Nothing to do.`);
  process.exit(0);
}
console.log(`  ${current || 'unreleased code'} → ${target}`);
run('git', ['checkout', '--quiet', target]);

step('Installing packages');
run('npm', ['install', '--no-audit', '--no-fund']);

step('Deploying');
writeConfig(state);
applyMigrations(state.name);
buildAndDeploy(state.name);

step('Checking that logs still reach Basin (about 3 minutes)');
const password =
  process.env.OPEN_LOGS_PASSWORD ||
  (await askHidden(`  Password for ${state.ownerEmail} (Enter to skip the check): `));
if (!password) {
  const health = await fetch(`${state.url}/api/health`).catch(() => null);
  console.log(
    `  Skipped the log check. The Worker ${health?.ok ? 'is up' : 'did not answer'} at ${state.url}`,
  );
  process.exit(health?.ok ? 0 : 1);
}
const flowing = await checkLogsFlow(state.url, state.ownerEmail, password);
console.log(
  flowing
    ? `\n✓ Updated to ${target}. Logs are flowing.`
    : '\n! Updated, but the test log was not found in Basin. To go back: npm run rollback',
);
if (!flowing) process.exit(1);
