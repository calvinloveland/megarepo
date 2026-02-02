import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/playwright',
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  timeout: 30_000,
});
