import { existsSync } from 'node:fs';
import { defineConfig } from 'playwright/test';

const port = 3104;
const baseURL = `http://127.0.0.1:${port}`;
const localChromePath = '/run/current-system/sw/bin/google-chrome-stable';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(localChromePath) ? localChromePath : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        channel: undefined,
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--no-sandbox']
        }
      }
    }
  ],
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry'
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120000
  }
});
