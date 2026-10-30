// Starts a fresh `wrangler dev` for Playwright: builds the React app, wipes local state, applies migrations, serves.
// Usage: node scripts/e2e-server.js [port] [persist dir]
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const port = process.argv[2] || '8788';
const persist = process.argv[3] || '.wrangler/e2e';
// This folder is wiped on start, so only ever accept one inside the repo's .wrangler/.
if (!resolve(persist).startsWith(resolve('.wrangler') + sep)) {
  console.error(`Refusing to wipe ${persist}: the persist dir must be inside .wrangler/`);
  process.exit(1);
}

rmSync(persist, { recursive: true, force: true });
const build = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const migrate = spawnSync(
  'npx',
  ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist],
  { stdio: 'inherit', env: { ...process.env, CI: '1' } },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const dev = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--port',
    port,
    '--persist-to',
    persist,
    '--var',
    'ADMIN_PASSWORD:e2e-admin-password',
    '--var',
    'E2E:1',
  ],
  { stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));
