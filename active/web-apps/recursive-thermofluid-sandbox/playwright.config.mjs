/**
 * Playwright configuration for NixOS.
 * Uses the system-installed Chromium from nixpkgs.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: 'tests/e2e.spec.mjs',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:5192',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || '/nix/store/r7ifk1v95jfl02775kgbrd61dyr1rfsx-chromium-148.0.7778.178/bin/chromium',
      args: ['--no-sandbox', '--headless=new'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
