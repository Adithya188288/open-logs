#!/usr/bin/env node
// npx create-open-logs [dir] → clone Open Logs, install, deploy to your Cloudflare account.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPO = process.env.OPEN_LOGS_REPO || 'https://github.com/Adithya188288/open-logs.git';
const dir = process.argv[2] || 'open-logs';

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (existsSync(dir)) {
  console.error(`${dir} already exists. Pick another folder: npx create-open-logs my-logs`);
  process.exit(1);
}
console.log(`Cloning Open Logs into ./${dir}`);
run('git', ['clone', '--depth', '1', '--branch', 'main', REPO, dir]);
run('npm', ['install', '--no-audit', '--no-fund'], dir);
run('node', ['scripts/install.js'], dir);
