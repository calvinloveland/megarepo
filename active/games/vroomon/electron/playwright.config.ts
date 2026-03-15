import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  outputDir: "test-results/playwright",
  use: {
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.VROOMON_BROWSER_EXECUTABLE,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
    },
  },
});
