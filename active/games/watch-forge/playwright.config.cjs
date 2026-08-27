// @ts-check
const { defineConfig } = require('@playwright/test');

// On NixOS we must point at a Nix-managed Chrome because Playwright's own
// download is dynamically linked and won't run. Default to the system Chrome;
// override with CHROMIUM_PATH if you have another Nix Chromium.
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  '/run/current-system/sw/bin/google-chrome';

const PORT = process.env.PORT || '5120';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // single worker — shared game server, deterministic timing
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: `node server.mjs`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
    env: { PORT },
  },
});