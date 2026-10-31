#!/usr/bin/env node
// npm run setup [-- --name my-logs]: installs Open Logs into your own Cloudflare account, in one go.
//   sign in → Basin (R2 bucket, catalog, stream, sink, pipeline) → D1 (app data) → build and deploy
//   → secrets → send a test log and wait until Basin can search it.
// Needs the Workers Paid plan (Basin) and one Cloudflare API token (see TOKEN_HELP).
// Non-interactive: set OPEN_LOGS_TOKEN and OPEN_LOGS_EMAIL (and OPEN_LOGS_PASSWORD to choose the password).
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { checkLogsFlow } from './check.js';
import {
  applyMigrations,
  ask,
  askHidden,
  BASIN_NAMESPACE,
  BASIN_TABLE,
  buildAndDeploy,
  configPath,
  hideInOutput,
  INSTALLS_DIR,
  installName,
  mustWrangler,
  run,
  saveState,
  step,
  wrangler,
  writeConfig,
} from './lib.js';

const TOKEN_HELP = `
Open Logs needs one Cloudflare API token, for writing logs into Basin and searching them:
  Cloudflare dashboard → R2 → Manage API tokens → Create Account API token
  → Permissions: Admin Read & Write (this includes Basin SQL Read) → Create → copy the token value.
  It is stored only as a secret on your Worker; nothing is written to disk.`;

const name = await installName();
if (!/^[a-z][a-z0-9-]{2,40}$/.test(name)) {
  console.error('The install name must be 3-41 lowercase letters, digits or dashes, starting with a letter.');
  process.exit(1);
}
if (existsSync(`${INSTALLS_DIR}/${name}.json`)) {
  console.error(`"${name}" is already installed. To update it: npm run update -- --name ${name}`);
  process.exit(1);
}
const base = name.replaceAll('-', '_');

step('Installing packages');
run('npm', ['install', '--no-audit', '--no-fund']);

step('Signing in to Cloudflare');
let who = wrangler(['whoami', '--json'], { quiet: true });
if (!who.ok) {
  if (!wrangler(['login']).ok) process.exit(1);
  who = wrangler(['whoami', '--json'], { quiet: true });
}
const accounts = /** @type {{ id: string, name: string }[]} */ (JSON.parse(who.out).accounts ?? []);
let account = accounts.find((a) => a.id === process.env.CLOUDFLARE_ACCOUNT_ID) ?? accounts[0];
if (accounts.length > 1 && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  for (const [i, a] of accounts.entries()) console.log(`  ${i + 1}. ${a.name}`);
  account = accounts[Number(await ask('  Which account? ')) - 1] ?? accounts[0];
}
process.env.CLOUDFLARE_ACCOUNT_ID = account.id;
console.log(`  Using account: ${account.name}`);

let token = process.env.OPEN_LOGS_TOKEN;
if (!token) {
  console.log(TOKEN_HELP);
  token = await askHidden('  Paste the token: ');
}
const email = process.env.OPEN_LOGS_EMAIL || (await ask('  Your email (you sign in with it): '));
if (!token || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('A token and a valid email are both required.');
  process.exit(1);
}
hideInOutput(token);

step('Creating Basin (where logs are stored)');
mustWrangler('R2 bucket', ['r2', 'bucket', 'create', name]);
mustWrangler('Basin Catalog', ['r2', 'bucket', 'catalog', 'enable', name]);
// biome-ignore format: one flag/value pair per line reads better here
mustWrangler('stream', [
  'pipelines', 'streams', 'create', `${base}_stream`,
  '--schema-file', 'basin/stream-schema.json', '--http-enabled', 'false',
]);
const streamId = mustWrangler('stream id', ['pipelines', 'streams', 'get', `${base}_stream`]).match(
  /Stream ID:\s*([0-9a-f]{32})/,
)?.[1];
if (!streamId) {
  console.error('Could not read the stream id. Check: npx wrangler pipelines streams list');
  process.exit(1);
}
// biome-ignore format: one flag/value pair per line reads better here
mustWrangler('Iceberg sink (files every 60s)', [
  'pipelines', 'sinks', 'create', `${base}_sink`,
  '--type', 'r2-data-catalog', '--bucket', name, '--namespace', BASIN_NAMESPACE, '--table', BASIN_TABLE,
  '--roll-interval', '60', '--compression', 'zstd', '--catalog-token', token,
]);
mustWrangler('pipeline', [
  'pipelines',
  'create',
  `${base}_pipeline`,
  '--sql',
  `INSERT INTO ${base}_sink SELECT * FROM ${base}_stream`,
]);

step('Creating D1 (app data: users, projects, sources, dashboards)');
const databaseId = mustWrangler('D1 database', ['d1', 'create', name]).match(
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
)?.[0];
if (!databaseId) {
  console.error(
    `Could not read the database id. If "${name}" already exists, delete it or pick another --name.`,
  );
  process.exit(1);
}

/** @type {import('./lib.js').InstallState} */
const state = {
  name,
  accountId: account.id,
  url: '',
  bucket: name,
  stream: `${base}_stream`,
  streamId,
  sink: `${base}_sink`,
  pipeline: `${base}_pipeline`,
  database: name,
  databaseId,
  ownerEmail: email,
};
saveState(state);
writeConfig(state);

step('Deploying');
applyMigrations(name);
state.url = buildAndDeploy(name);
saveState(state);

step('Setting secrets');
const password = process.env.OPEN_LOGS_PASSWORD || randomBytes(18).toString('base64url');
hideInOutput(password);
const secrets = wrangler(['secret', 'bulk', '-c', configPath(name)], {
  input: JSON.stringify({ ADMIN_PASSWORD: password, BASIN_SQL_TOKEN: token }),
});
if (!secrets.ok) {
  console.error(secrets.out);
  process.exit(1);
}
console.log('  • ADMIN_PASSWORD and BASIN_SQL_TOKEN… done');

step('Checking that logs reach Basin (this takes about 3 minutes)');
const flowing = state.url && (await checkLogsFlow(state.url, email, password));

console.log(`
${flowing ? '✓ Open Logs is installed and your logs are flowing.' : '! Open Logs is deployed, but the test log was not found in Basin yet.'}

  URL       ${state.url}
  Email     ${email}
  Password  ${process.env.OPEN_LOGS_PASSWORD ? '(the one you set in OPEN_LOGS_PASSWORD)' : `${password}\n            Save it now: it is not shown again. You can change it in Settings.`}

  Recommended: put this URL behind Cloudflare Access (free for up to 50 users) so only your team can
  reach it. Leave /v1/logs outside Access: your apps send logs there with their token. See README → Security.

  Update:     npm run update -- --name ${name}
  Roll back:  npm run rollback -- --name ${name}
  Remove:     npm run uninstall -- --name ${name}
`);
if (!flowing) process.exit(1);
