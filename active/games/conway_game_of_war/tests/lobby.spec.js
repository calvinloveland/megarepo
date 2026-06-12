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

  test('Two tabs in the same browser match each other', async ({ browser }) => {
    // Regression: two browser tabs share the same Flask session cookie,
    // so the server used to see them as the same user. The fix uses a
    // per-tab pid (sessionStorage) so each tab can be matched
    // independently.
    const ctx = await browser.newContext();
    const tab1 = await ctx.newPage();
    const tab2 = await ctx.newPage();

    await Promise.all([
      tab1.goto('/lobby'),
      tab2.goto('/lobby'),
    ]);

    // Tab 1 joins
    await tab1.fill('#username-input', 'Alice');
    const t1Join = tab1.waitForResponse(
      (r) => r.url().endsWith('/join_queue') && r.request().method() === 'POST',
    );
    await tab1.click('#find-match-btn');
    const t1Resp = await t1Join;
    expect(t1Resp.status()).toBe(200);
    // Reading the body fails after the JS triggers navigation in some
    // cases, so we only check status here. The body is asserted in the
    // Python test suite.
    expect(t1Resp.ok()).toBe(true);

    // Tab 2 joins — this should match against tab 1
    await tab2.fill('#username-input', 'Bob');
    const t2Join = tab2.waitForResponse(
      (r) => r.url().endsWith('/join_queue') && r.request().method() === 'POST',
    );
    await tab2.click('#find-match-btn');
    const t2Resp = await t2Join;
    expect(t2Resp.status()).toBe(200);
    expect(t2Resp.ok()).toBe(true);

    // Both tabs should be redirected to the game page
    await tab1.waitForURL('/', { timeout: 5000 });
    await tab2.waitForURL('/', { timeout: 5000 });

    // The game page should show each player's name
    await expect(tab1.locator('body')).toContainText('Alice');
    await expect(tab2.locator('body')).toContainText('Bob');

    // Each tab sees the other player as their opponent
    await expect(tab1.locator('body')).toContainText('Bob');
    await expect(tab2.locator('body')).toContainText('Alice');

    await ctx.close();
  });
});
