// npm run verify: Playwright against the checked-out branch's own install on Cloudflare (npm run deploy first).
// Basin has no local version, so every test runs against a real install. Order:
//   seed  → signs in, creates a project and sources, sends logs (Basin's ~2 minute clock starts here)
//   app   → everything that needs no log data (UI flows, API rules), while Basin catches up
//   basin → waits until the seeded logs are searchable, then checks search, live tail and the dashboard
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { branchInstall, INSTALLS_DIR, loadDevVars } from './scripts/lib.js';

loadDevVars();
const install = process.env.OPEN_LOGS_INSTALL || branchInstall();
const statePath = `${INSTALLS_DIR}/${install}.json`;
if (!existsSync(statePath)) throw new Error(`No install "${install}" yet. Run: npm run deploy`);
if (!process.env.OPEN_LOGS_EMAIL || !process.env.OPEN_LOGS_PASSWORD) {
  throw new Error('Set OPEN_LOGS_EMAIL and OPEN_LOGS_PASSWORD in .dev.vars (see .dev.vars.example).');
}
const { url } = JSON.parse(readFileSync(statePath, 'utf8'));

// One id per run: everything a run creates carries it, so runs never read each other's data.
process.env.E2E_RUN ||= Date.now().toString(36);

const chrome = { ...devices['Desktop Chrome'] };
const owner = 'tests/.state/owner.json';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/report' }]],
  use: { baseURL: url, trace: 'retain-on-failure', screenshot: 'on', video: 'on' },
  projects: [
    { name: 'seed', testMatch: /seed\.setup\.js/, use: chrome },
    {
      name: 'app',
      testDir: 'tests/app',
      dependencies: ['seed'],
      use: { ...chrome, storageState: owner },
    },
    {
      name: 'basin',
      testDir: 'tests/basin',
      dependencies: ['seed'],
      use: { ...chrome, storageState: owner },
    },
  ],
});
