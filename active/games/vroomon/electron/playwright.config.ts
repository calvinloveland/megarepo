import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  // Tests are isolated contexts, so they can run in parallel — this is the
  // single biggest lever on suite wall-clock time (22 tests × ~2s boot).
  fullyParallel: true,
  workers: Number(process.env.VROOMON_E2E_WORKERS ?? 4),
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
