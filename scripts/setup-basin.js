#!/usr/bin/env node
// Creates the Basin resources Open Logs needs, via wrangler. Safe to re-run: "already exists" is fine.
//   R2 bucket + Basin Catalog → stream (schema) → Iceberg sink (60s roll) → pipeline (stream → sink)
// Needs: `wrangler login`, a Workers Paid plan, and R2_CATALOG_TOKEN (an R2 "Admin Read & Write" API token,
// required by the Iceberg sink). Keep the token in .dev.vars (gitignored) and run:
//   node --env-file=.dev.vars scripts/setup-basin.js [bucket] [roll-interval-seconds]
// Flags verified against `wrangler pipelines … --help` (wrangler 4.156, 2026-10-30).
import { spawnSync } from 'node:child_process';

const bucket = process.argv[2] || 'open-logs';
// Fixed when the sink is created (sinks can't be updated). 60s is the minimum for Iceberg sinks.
const rollInterval = Math.max(60, Number(process.argv[3]) || 60);
const catalogToken = process.env.R2_CATALOG_TOKEN;
if (!catalogToken) {
  console.error(
    'R2_CATALOG_TOKEN is not set. Add it to .dev.vars and run with: node --env-file=.dev.vars scripts/setup-basin.js',
  );
  process.exit(1);
}
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
  // Never echo the catalog token back, even inside an error message.
  const out = `${r.stdout}\n${r.stderr}`.replaceAll(catalogToken, '***');
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
// biome-ignore format: one flag/value pair per line reads better here
wrangler('stream', [
  'pipelines', 'streams', 'create', 'open_logs_stream',
  '--schema-file', 'basin/stream-schema.json', '--http-enabled', 'false',
]);
// biome-ignore format: one flag/value pair per line reads better here
wrangler(`Iceberg sink (${rollInterval}s roll)`, [
  'pipelines', 'sinks', 'create', 'open_logs_sink',
  '--type', 'r2-data-catalog', '--bucket', bucket, '--namespace', NAMESPACE, '--table', TABLE,
  '--roll-interval', String(rollInterval), '--compression', 'zstd', '--catalog-token', catalogToken,
]);
wrangler('pipeline', [
  'pipelines',
  'create',
  'open_logs_pipeline',
  '--sql',
  'INSERT INTO open_logs_sink SELECT * FROM open_logs_stream',
]);

const streamInfo = wrangler('stream id', ['pipelines', 'streams', 'get', 'open_logs_stream']);
const streamId =
  streamInfo.match(/Stream ID:\s*([0-9a-f]{32})/)?.[1] ?? '(see `npx wrangler pipelines streams list`)';
console.log(`
Next steps
  1. In wrangler.jsonc → env.staging set:
       stream id      ${streamId}
       BASIN_BUCKET   ${bucket}
       BASIN_TABLE    ${NAMESPACE}.${TABLE}
       BASIN_ACCOUNT_ID  your account id (npx wrangler whoami)
  2. Create an API token with Basin SQL read, Basin Catalog read and R2 read, then:
       npx wrangler secret put BASIN_SQL_TOKEN --env staging
       npx wrangler secret put ADMIN_PASSWORD --env staging
  3. npx wrangler deploy --env staging        (creates the D1 database on first deploy)
  4. npx wrangler d1 migrations apply DB --remote --env staging
`);
