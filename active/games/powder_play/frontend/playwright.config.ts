import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  timeout: 30_000,
});
