// Shared helpers for setup, update, rollback and uninstall.
// Each install lives in .open-logs/ (gitignored): <name>.jsonc is its wrangler config,
// <name>.json records the Cloudflare resources it created, so later commands know what to update or remove.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

export const INSTALLS_DIR = '.open-logs';
export const BASIN_NAMESPACE = 'open_logs';
export const BASIN_TABLE = 'events';
const SECRETS = /** @type {string[]} */ ([]);

/** Values that must never be printed, even inside wrangler's error output. @param {string} value */
export function hideInOutput(value) {
  if (value) SECRETS.push(value);
}

/** @param {string} text */
function redact(text) {
  return SECRETS.reduce((out, secret) => out.replaceAll(secret, '***'), text);
}

/** @param {string} label */
export function step(label) {
  console.log(`\n→ ${label}`);
}

/**
 * Runs wrangler and returns its output. `input` is piped to stdin (never echoed).
 * @param {string[]} args
 * @param {{ input?: string, quiet?: boolean }} [opts]
 */
export function wrangler(args, opts = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    input: opts.input,
    stdio: opts.input !== undefined || opts.quiet ? 'pipe' : 'inherit',
  });
  return { ok: r.status === 0, out: redact(`${r.stdout ?? ''}${r.stderr ?? ''}`) };
}

/** Cloudflare's API sometimes answers with an HTML error page or a 5xx; those are worth retrying. */
const TRANSIENT =
  /<!DOCTYPE html|\b50[0-9]\b|internal server error|timed out|ETIMEDOUT|ECONNRESET|temporarily/i;

/**
 * Like `wrangler`, but stops the whole command with the output when it fails. Retries temporary Cloudflare
 * errors twice. "Already exists" counts as success, so setup can be re-run after a partial failure.
 * @param {string} label
 * @param {string[]} args
 */
export function mustWrangler(label, args) {
  process.stdout.write(`  • ${label}… `);
  let r = wrangler(args, { quiet: true });
  for (let attempt = 1; attempt < 3 && !r.ok && TRANSIENT.test(r.out); attempt++) {
    spawnSync('sleep', [String(5 * attempt)]);
    r = wrangler(args, { quiet: true });
  }
  if (r.ok || /already exists|already enabled|conflict/i.test(r.out)) {
    console.log(r.ok ? 'done' : 'already there');
    return r.out;
  }
  console.log('failed');
  console.error(r.out.length > 2000 ? `${r.out.slice(0, 2000)}…` : r.out);
  process.exit(1);
}

/** @param {string} cmd @param {string[]} args */
export function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** @param {string} question */
export function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

/** Asks without echoing what is typed (for tokens). @param {string} question */
export function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = /** @type {any} */ (rl)._writeToOutput;
    /** @type {any} */ (rl)._writeToOutput = (/** @type {string} */ s) =>
      write.call(rl, s.startsWith(question) ? question : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/** Reads `--name <value>` style flags. @param {string} flag */
export function flag(flag) {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** @param {string} name */
export const configPath = (name) => `${INSTALLS_DIR}/${name}.jsonc`;
/** @param {string} name */
const statePath = (name) => `${INSTALLS_DIR}/${name}.json`;

/**
 * @typedef {{ name: string, accountId: string, url: string, bucket: string, stream: string, streamId: string,
 *   sink: string, pipeline: string, database: string, databaseId: string, ownerEmail: string }} InstallState
 */

/** @param {InstallState} state */
export function saveState(state) {
  mkdirSync(INSTALLS_DIR, { recursive: true });
  writeFileSync(statePath(state.name), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * The install named by --name, or the only one there is.
 * @returns {InstallState}
 */
export function loadState() {
  const names = existsSync(INSTALLS_DIR)
    ? readdirSync(INSTALLS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
    : [];
  const name = flag('name') ?? (names.length === 1 ? names[0] : undefined);
  if (!name || !names.includes(name)) {
    console.error(
      names.length
        ? `Pick an install with --name (${names.join(', ')}).`
        : 'No Open Logs install found here. Run: npm run setup',
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(statePath(name), 'utf8'));
}

/**
 * Writes the install's wrangler config from wrangler.jsonc (the template), filling in its own resources.
 * Paths point back to the repo because the file lives in .open-logs/.
 * @param {InstallState} state
 */
export function writeConfig(state) {
  const template = JSON.parse(
    readFileSync('wrangler.jsonc', 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n'),
  );
  delete template.$schema;
  const config = {
    ...template,
    name: state.name,
    main: `../${template.main}`,
    assets: { ...template.assets, directory: `../${template.assets.directory.replace(/^\.\//, '')}` },
    d1_databases: [
      {
        binding: 'DB',
        database_name: state.database,
        database_id: state.databaseId,
        migrations_dir: '../migrations',
      },
    ],
    pipelines: [{ binding: 'LOG_STREAM', stream: state.streamId }],
    vars: {
      ...template.vars,
      BASIN_ACCOUNT_ID: state.accountId,
      BASIN_BUCKET: state.bucket,
      BASIN_TABLE: `${BASIN_NAMESPACE}.${BASIN_TABLE}`,
    },
  };
  mkdirSync(INSTALLS_DIR, { recursive: true });
  writeFileSync(
    configPath(state.name),
    `// Generated by \`npm run setup\` for this install. Do not commit: it holds your account's resource ids.\n${JSON.stringify(config, null, 2)}\n`,
  );
}

/** Builds the UI and deploys the Worker; returns its workers.dev URL. @param {string} name */
export function buildAndDeploy(name) {
  run('npx', ['vite', 'build']);
  process.stdout.write('  • Worker… ');
  const r = wrangler(['deploy', '-c', configPath(name)], { quiet: true });
  if (!r.ok) {
    console.log('failed');
    console.error(r.out);
    process.exit(1);
  }
  console.log('done');
  return r.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? '';
}

/** @param {string} name */
export function applyMigrations(name) {
  mustWrangler('D1 tables', ['d1', 'migrations', 'apply', 'DB', '--remote', '-c', configPath(name)]);
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
