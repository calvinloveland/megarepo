// @ts-check
const { defineConfig } = require('@playwright/test');

// On NixOS we must point to a Nix-managed Chromium because the
// Playwright-downloaded binary is dynamically linked and won't run.
// Override with CHROMIUM_PATH env var if your path differs.
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  '/nix/store/r7ifk1v95jfl02775kgbrd61dyr1rfsx-chromium-148.0.7778.178/bin/chromium';

const PORT = process.env.PORT || '3003';

module.exports = defineConfig({
  testDir: './tests',
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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
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
