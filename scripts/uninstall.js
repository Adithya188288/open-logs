#!/usr/bin/env node
// npm run uninstall [-- --name my-logs]: removes everything setup created in Cloudflare, logs included.
//   Worker (and its secrets) → every pipeline, sink and stream with the install's name → Basin table
//   → Basin Catalog (deleted, not just disabled) → every file in the bucket → bucket → D1.
// The API token itself can't be deleted by a script (Cloudflare doesn't allow it): the last step links to it.
import { rmSync } from 'node:fs';
import {
  ask,
  askHidden,
  BASIN_NAMESPACE,
  BASIN_TABLE,
  configPath,
  hideInOutput,
  INSTALLS_DIR,
  loadState,
  step,
  wrangler,
} from './lib.js';

const API = 'https://api.cloudflare.com/client/v4/accounts';
const state = loadState();
process.env.CLOUDFLARE_ACCOUNT_ID = state.accountId;

console.log(`
This permanently deletes the Open Logs install "${state.name}" (${state.url || 'no URL recorded'}):
the Worker, all of its logs in Basin, and its D1 database (users, projects, dashboards).`);
if ((await ask(`  Type "${state.name}" to confirm: `)) !== state.name) {
  console.log('  Nothing was deleted.');
  process.exit(1);
}
const token =
  process.env.OPEN_LOGS_TOKEN || (await askHidden('  Paste the Basin API token (to empty the bucket): '));
hideInOutput(token);

/** @type {[string, 'removed' | 'already gone' | 'failed'][]} */
const results = [];

/** @param {string} label @param {string[]} args */
function remove(label, args) {
  const r = wrangler(args, { quiet: true });
  const outcome = r.ok
    ? 'removed'
    : /not found|does not exist|could not find|couldn't find|10007|no such/i.test(r.out)
      ? 'already gone'
      : 'failed';
  results.push([label, outcome]);
  console.log(`  • ${label}… ${outcome}`);
  if (outcome === 'failed') console.error(r.out.trim().split('\n').slice(-3).join('\n'));
}

/**
 * Deletes every pipeline, sink or stream with this name. Listing (rather than deleting by name once) also
 * catches a duplicate left behind when a setup step reported an error but still created the resource.
 * @param {string} label
 * @param {'pipelines' | 'sinks' | 'streams'} kind
 * @param {string} name
 */
function removeAllNamed(label, kind, name) {
  const group = kind === 'pipelines' ? ['pipelines'] : ['pipelines', kind];
  const listed = wrangler([...group, 'list', '--json', '--per-page', '100'], { quiet: true });
  /** @type {{ id: string, name: string }[]} */
  let items = [];
  try {
    items = JSON.parse(listed.out.slice(listed.out.indexOf('['))).filter(
      (/** @type {any} */ i) => i.name === name,
    );
  } catch {}
  if (!listed.ok) {
    results.push([label, 'failed']);
    console.log(`  • ${label}… failed`);
    console.error(listed.out.trim().split('\n').slice(-3).join('\n'));
    return;
  }
  if (!items.length) {
    results.push([label, 'already gone']);
    console.log(`  • ${label}… already gone`);
    return;
  }
  for (const item of items)
    remove(items.length > 1 ? `${label} ${item.id}` : label, [...group, 'delete', item.id, '--force']);
}

/**
 * Deletes the catalog itself. `wrangler … catalog disable` only switches it off and leaves it in the account,
 * so this calls Cloudflare's delete endpoint; force=true also removes its namespaces, tables and views.
 */
async function deleteCatalog() {
  wrangler(['r2', 'bucket', 'catalog', 'disable', state.bucket], { quiet: true });
  const res = await fetch(
    `${API}/${state.accountId}/basin-catalog/${encodeURIComponent(state.bucket)}/delete?force=true`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (res.ok) return 'removed';
  if (res.status === 404) return 'already gone';
  const body = await res.json().catch(() => ({}));
  console.error(
    `  Deleting the catalog failed (${res.status}): ${body.errors?.[0]?.message ?? 'unknown error'}`,
  );
  return 'failed';
}

/**
 * Deletes the Iceberg table and its namespace from Basin Catalog (its REST API). Without this the catalog keeps
 * the table registered, and a later install into a bucket of the same name can't create its sink.
 */
async function dropCatalogTable() {
  const catalog = `https://catalog.cloudflarestorage.com/${state.accountId}/${state.bucket}/v1`;
  const headers = { authorization: `Bearer ${token}` };
  const config = await fetch(`${catalog}/config?warehouse=${state.accountId}_${state.bucket}`, { headers });
  if (config.status === 404) return 'already gone';
  const prefix = (await config.json().catch(() => ({})))?.overrides?.prefix;
  if (!config.ok || !prefix) return 'failed';
  const namespace = `${catalog}/${prefix}/namespaces/${BASIN_NAMESPACE}`;
  const table = await fetch(`${namespace}/tables/${BASIN_TABLE}?purgeRequested=true`, {
    method: 'DELETE',
    headers,
  });
  const ns = await fetch(namespace, { method: 'DELETE', headers });
  if (![200, 204, 404].includes(table.status) || ![200, 204, 404].includes(ns.status)) return 'failed';
  return table.status === 404 && ns.status === 404 ? 'already gone' : 'removed';
}

let deletedFiles = 0;

/** Lists and deletes every object in the bucket through the Cloudflare API. */
async function emptyBucket() {
  const base = `${API}/${state.accountId}/r2/buckets/${encodeURIComponent(state.bucket)}/objects`;
  const headers = { authorization: `Bearer ${token}` };
  for (;;) {
    const res = await fetch(`${base}?per_page=1000`, { headers });
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) return 'already gone';
    if (!res.ok || !Array.isArray(body.result)) {
      console.error(`  Listing the bucket failed (${res.status}).`);
      return 'failed';
    }
    if (!body.result.length) break;
    for (const object of body.result) {
      const del = await fetch(`${base}/${encodeURIComponent(object.key)}`, { method: 'DELETE', headers });
      if (!del.ok && del.status !== 404) {
        console.error(`  Deleting ${object.key} failed (${del.status}).`);
        return 'failed';
      }
      deletedFiles += 1;
    }
  }
  return 'removed';
}

step('Removing');
remove('Worker and its secrets', ['delete', state.name, '--force']);
removeAllNamed('pipeline', 'pipelines', state.pipeline);
removeAllNamed('sink', 'sinks', state.sink);
removeAllNamed('stream', 'streams', state.stream);
process.stdout.write('  • Basin table… ');
const dropped = await dropCatalogTable();
results.push(['Basin table', dropped]);
console.log(dropped);
process.stdout.write('  • Basin Catalog… ');
const catalogDeleted = await deleteCatalog();
results.push(['Basin Catalog', catalogDeleted]);
console.log(catalogDeleted);
process.stdout.write('  • log files in the bucket… ');
const emptied = await emptyBucket();
results.push(['log files in the bucket', emptied]);
console.log(emptied === 'removed' ? `removed (${deletedFiles} files)` : emptied);
remove('R2 bucket', ['r2', 'bucket', 'delete', state.bucket]);
remove('D1 database', ['d1', 'delete', state.database, '--skip-confirmation']);

const failed = results.filter(([, outcome]) => outcome === 'failed');
if (!failed.length) {
  rmSync(configPath(state.name), { force: true });
  rmSync(`${INSTALLS_DIR}/${state.name}.json`, { force: true });
}
console.log(`
${failed.length ? `! ${failed.length} step(s) failed; fix them and run this again (it skips what is already gone).` : `✓ "${state.name}" is removed from Cloudflare.`}

  Last step, by hand: delete the API token you created for Open Logs.
  Cloudflare dashboard → R2 → Manage API tokens → find it → Delete.
  (Cloudflare doesn't let a script delete API tokens.)
`);
if (failed.length) process.exit(1);
