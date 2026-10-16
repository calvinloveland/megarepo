// @ts-check
const fs = require('node:fs');
const { defineConfig } = require('@playwright/test');

/* NixOS: Playwright's downloaded Chromium will not run, so point at a
   Nix-managed browser. CHROMIUM_PATH wins if set, then the Chrome that ships
   with this host, then Playwright's own resolution as a last resort. */
function resolveBrowser() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/run/current-system/sw/bin/google-chrome-stable',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const executablePath = resolveBrowser();
const PORT = process.env.PORT || '8099';

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.cjs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
      ],
    },
  },
  webServer: {
    command: 'node server.mjs',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    env: { PORT },
  },
});
