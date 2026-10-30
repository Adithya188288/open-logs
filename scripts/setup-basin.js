#!/usr/bin/env node
// Creates the Basin resources Open Logs needs, via wrangler. Safe to re-run: "already exists" is fine.
//   R2 bucket + Basin Catalog → stream (schema) → Iceberg sink (60s roll) → pipeline (stream → sink)
// Needs: `wrangler login`, a Workers Paid plan. Usage: node scripts/setup-basin.js [bucket]
// Command names verified against developers.cloudflare.com/basin-sql/tutorials/end-to-end-pipeline (2026-10-30).
import { spawnSync } from 'node:child_process';

const bucket = process.argv[2] || 'open-logs';
const NAMESPACE = 'open_logs';
const TABLE = 'events';

/**
 * Runs a wrangler command; tolerates "already exists" so the script is idempotent.
 * @param {string} label
 * @param {string[]} args
 */
function wrangler(label, args) {
  process.stdout.write(`• ${label}… `);
  const r = spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.status === 0) {
    console.log('done');
    return out;
  }
  if (/already exists|already enabled|conflict/i.test(out)) {
    console.log('already there');
    return out;
  }
  console.log('failed');
  console.error(out);
  process.exit(1);
}

wrangler('R2 bucket', ['r2', 'bucket', 'create', bucket]);
wrangler('Basin Catalog', ['basin', 'catalog', 'enable', bucket]);
const stream = wrangler('stream', [
  'basin',
  'pipelines',
  'streams',
  'create',
  'open_logs_stream',
  '--schema-file',
  'basin/stream-schema.json',
  '--http-enabled',
  'false',
]);
wrangler('Iceberg sink (60s roll)', [
  'basin',
  'pipelines',
  'sinks',
  'create',
  'open_logs_sink',
  '--type',
  'basin-catalog',
  '--bucket',
  bucket,
  '--roll-interval',
  '60',
  '--namespace',
  NAMESPACE,
  '--table',
  TABLE,
]);
wrangler('pipeline', [
  'basin',
  'pipelines',
  'create',
  'open_logs_pipeline',
  '--sql',
  'INSERT INTO open_logs_sink SELECT * FROM open_logs_stream',
]);
const d1 = wrangler('D1 database', ['d1', 'create', 'open-logs-staging']);

const streamId = stream.match(/[0-9a-f]{32}/)?.[0] ?? '(see `npx wrangler basin pipelines streams list`)';
const d1Id =
  d1.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ??
  '(see `npx wrangler d1 list`)';
console.log(`
Next steps
  1. In wrangler.jsonc → env.staging set:
       stream id      ${streamId}
       D1 id          ${d1Id}
       BASIN_BUCKET   ${bucket}
       BASIN_TABLE    ${NAMESPACE}.${TABLE}
       BASIN_ACCOUNT_ID  your account id (npx wrangler whoami)
  2. Create an API token with Basin SQL read, Basin Catalog read and R2 read, then:
       npx wrangler secret put BASIN_SQL_TOKEN --env staging
       npx wrangler secret put ADMIN_PASSWORD --env staging
  3. npx wrangler d1 migrations apply DB --remote --env staging
  4. npx wrangler deploy --env staging
`);
