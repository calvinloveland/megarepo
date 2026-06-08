// @ts-check
const { defineConfig } = require('@playwright/test');

// On NixOS we must point to the system-installed Chromium.
const CHROMIUM_PATH = '/nix/store/r7ifk1v95jfl02775kgbrd61dyr1rfsx-chromium-148.0.7778.178/bin/chromium';

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Flask server is single-process
  reporter: 'list',
  timeout: 20_000,
  use: {
    baseURL: 'http://127.0.0.1:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  // Start Flask before tests, kill after
  webServer: {
    command: '.venv/bin/python -m conways_game_of_war.main',
    url: 'http://127.0.0.1:5000',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
