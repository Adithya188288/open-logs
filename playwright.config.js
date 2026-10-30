import { defineConfig, devices } from '@playwright/test';

const PORT = 8790;
const owner = 'e2e/.auth/owner.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'light',
      dependencies: ['setup'],
      testMatch: /\.spec\.js/,
      use: { ...devices['Desktop Chrome'], storageState: owner, theme: 'light' },
    },
    {
      name: 'dark',
      dependencies: ['setup'],
      testMatch: /\.spec\.js/,
      use: { ...devices['Desktop Chrome'], storageState: owner, theme: 'dark', colorScheme: 'dark' },
    },
  ],
  webServer: {
    command: `node scripts/e2e-server.js ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
  },
});
