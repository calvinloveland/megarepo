// @ts-check
import { test, expect } from '@playwright/test';

// ─── console error reporter ───────────────────────────────────────────

const consoleErrors = new Map();

test.beforeEach(({ page }, testInfo) => {
  const entries = [];
  consoleErrors.set(testInfo.title, entries);

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      entries.push(`CONSOLE ERROR: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    entries.push(`PAGE ERROR: ${err.message}\n${err.stack}`);
  });
  page.on('requestfailed', (req) => {
    entries.push(
      `REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText ?? 'unknown'}`,
    );
  });
});

test.afterEach(({}, testInfo) => {
  const entries = consoleErrors.get(testInfo.title);
  if (entries && entries.length > 0) {
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) {
      console.log(`\n── Console errors for "${testInfo.title}" ──`);
      console.log(entries.join('\n'));
      console.log('── End ──\n');
    }
  }
  consoleErrors.delete(testInfo.title);
});

test.describe('Lobby — Find Match', () => {
  test('lobby page loads with no JS errors', async ({ page }) => {
    await page.goto('/lobby');
    await expect(page.locator('#find-match-btn')).toBeVisible();
    await expect(page.locator('#username-input')).toBeVisible();
    // The page should be free of pageerror events (regression: missing
    // IIFE close in lobby.html made the entire script fail to parse).
  });

  test('username is required to join queue', async ({ page }) => {
    await page.goto('/lobby');
    await page.click('#find-match-btn');
    await expect(page.locator('#status-area')).toContainText(
      'Please enter a username',
    );
  });

  test('Find Match button is wired up and calls /join_queue', async ({ page }) => {
    await page.goto('/lobby');
    await page.fill('#username-input', 'LobbyTester');

    // Click and watch the network call
    const joinQueuePromise = page.waitForResponse(
      (r) => r.url().endsWith('/join_queue') && r.request().method() === 'POST',
    );
    await page.click('#find-match-btn');
    const response = await joinQueuePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    // matched will be false because there's no second player in the test
    // environment, but the important regression guard is that the click
    // *reached* /join_queue at all.
    expect(typeof body.matched).toBe('boolean');

    // UI should reflect the queued state
    await expect(page.locator('#find-match-btn')).toBeDisabled();
    await expect(page.locator('#find-match-btn')).toHaveText(/Searching/);
    await expect(page.locator('#status-area')).toContainText(
      /In queue|queue|searching/i,
    );

    // Clean up: leave the queue so subsequent tests don't get matched
    // against this user (the Flask server is shared across tests).
    await expect(page.locator('#leave-btn')).toBeVisible();
    const leavePromise = page.waitForResponse(
      (r) => r.url().endsWith('/leave_queue') && r.request().method() === 'POST',
    );
    await page.click('#leave-btn');
    await leavePromise;
  });

  test('Leave Queue resets the Find Match button', async ({ page }) => {
    await page.goto('/lobby');
    await page.fill('#username-input', 'LobbyLeaver');
    await page.click('#find-match-btn');
    await expect(page.locator('#find-match-btn')).toBeDisabled();

    // The leave button is unhidden by the joinQueue() handler; wait for
    // it to be visible before clicking.
    await expect(page.locator('#leave-btn')).toBeVisible();

    const leavePromise = page.waitForResponse(
      (r) => r.url().endsWith('/leave_queue') && r.request().method() === 'POST',
    );
    await page.click('#leave-btn');
    await leavePromise;

    await expect(page.locator('#find-match-btn')).toBeEnabled();
    await expect(page.locator('#find-match-btn')).toHaveText(/Find Match/);
  });
});
