// Starts a fresh `wrangler dev` for Playwright: builds the React app, wipes local state, applies migrations, serves.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const port = process.argv[2] || '8788';
const persist = '.wrangler/e2e';

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
