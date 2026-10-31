#!/usr/bin/env node
// npm run update [-- --name my-logs] [-- --to v0.2.0]: moves an install to the newest release.
//   newest release tag → packages → new D1 migrations only (D1 remembers which ran) → build and deploy → check.
// Releases only add to the database (see CLAUDE.md), so the running Worker keeps working while this runs.
import { spawnSync } from 'node:child_process';
import { checkUp } from './check.js';
import { applyMigrations, buildAndDeploy, flag, loadState, run, step, writeConfig } from './lib.js';

/** @param {string[]} args */
const git = (args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();

const state = await loadState();
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

step('Checking the app is up');
const up = await checkUp(state.url);
console.log(
  up
    ? `\n✓ Updated to ${target}. Open Logs is up at ${state.url}`
    : `\n! Updated, but the app did not answer at ${state.url}. To go back: npm run rollback -- --name ${state.name}`,
);
if (!up) process.exit(1);
