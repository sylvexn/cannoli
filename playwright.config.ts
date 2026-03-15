import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Cannoli e2e + visual regression suite.
 *
 * First-time setup:
 *   bun add -d @playwright/test
 *   bunx playwright install chromium
 *
 * Run all e2e:        bun run test:e2e
 * Run with UI:        bun run test:e2e:ui
 * Update snapshots:   bun run test:e2e -- -u
 *
 * The webServer block boots both backend (3001) and frontend (5173) before tests.
 * `globalSetup` resets the mock DB so each run starts from the same fixture.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/.results',
  snapshotDir: './tests/e2e/__screenshots__',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'bun run --cwd backend dev',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { CANNOLI_MODE: 'mock' },
    },
    {
      command: 'bun run --cwd frontend dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
