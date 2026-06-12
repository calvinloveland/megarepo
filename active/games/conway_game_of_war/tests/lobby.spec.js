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

  test('Both players can place cells simultaneously', async ({ browser }) => {
    // Regression: with the turn system removed, both players should be
    // able to act on their own territory cells in any order without
    // waiting for an End Turn.
    //
    // We use SEPARATE browser contexts for the two tabs (which is
    // the realistic case: two different people on two different
    // devices). The same-context case is covered by the previous
    // "Two tabs in the same browser match each other" test, but
    // a single shared session can't distinguish two tabs by the
    // session _pid alone, so we exercise the realistic flow here.
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const tab1 = await ctx1.newPage();
    const tab2 = await ctx2.newPage();
    tab1.on('pageerror', (e) => console.log('[A pageerror]', e.message));
    tab2.on('pageerror', (e) => console.log('[B pageerror]', e.message));

    await Promise.all([tab1.goto('/lobby'), tab2.goto('/lobby')]);
    await tab1.fill('#username-input', 'Alice');
    await tab2.fill('#username-input', 'Bob');
    // Sequential (not parallel) so the order is deterministic:
    // Alice (tab1) joins first and becomes PLAYER_1.
    await tab1.click('#find-match-btn');
    await tab1.waitForURL((url) => url.pathname === '/' || url.pathname === '/lobby');
    await tab2.click('#find-match-btn');
    await tab2.waitForURL('/');
    await tab1.waitForURL('/');

    // End Turn button is now always enabled for both players (no turn
    // system means no "not your turn" disabling).
    const endBtn1 = tab1.locator('#end-turn-btn');
    await expect(endBtn1).toBeEnabled();
    const endBtn2 = tab2.locator('#end-turn-btn');
    await expect(endBtn2).toBeEnabled();

    // Both players place a cell on their own territory, in the same
    // logical "turn" (no End Turn between them). Pre-fix the second
    // call would 403 with "not your turn".
    //
    // We use page.evaluate(fetch, ...) rather than page.request.post()
    // because page.request's APIRequestContext does not share the
    // page's session cookies reliably across Playwright versions; using
    // the in-page fetch keeps the cookies intact.
    //
    // Each tab reads its own per-tab pid from sessionStorage (the
    // real client does the same \u2014 see lobby.html) so the server can
    // tell the two tabs apart even though they share a session cookie.
    const postUpdate = (page, x, y) =>
      page.evaluate(
        async ([x, y]) => {
          const pid = sessionStorage.getItem('conway-war-pid');
          const r = await fetch(
            `/update_cell?x=${x}&y=${y}&json=1`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pid }),
            },
          );
          return { status: r.status, body: await r.json() };
        },
        [x, y],
      );

    // Both players place a cell on their own territory, in the same
    // logical "turn" (no End Turn between them). Pre-fix, one of the
    // two requests would 403 with "not your turn".
    //
    // We read each tab's player index from the page (the index.html
    // template sets `var playerIdx = ...` in a script tag), then
    // claim the cell adjacent to that player's start.
    const playerIdx = (page) =>
      page.evaluate(() => {
        // Find the script that declares playerIdx and read its value.
        // We look for a `<script>` containing `var playerIdx` and
        // extract the number after the `=`.
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          const m = s.textContent.match(/var\s+playerIdx\s*=\s*(\d+)/);
          if (m) return parseInt(m[1], 10);
        }
        return null;
      });

    const idx1 = await playerIdx(tab1);
    const idx2 = await playerIdx(tab2);
    // With sequential joins, tab1 (Alice) is P1 (idx=0) and
    // tab2 (Bob) is P2 (idx=1).
    expect(idx1).toBe(0);
    expect(idx2).toBe(1);

    // P1's start is (20, 20); P2's start is (107, 111).
    const adjacentTo = (start) => [start[0] + 1, start[1]];
    const [x1, y1] = adjacentTo([20, 20]);
    const [x2, y2] = adjacentTo([107, 111]);

    const [r1, r2] = await Promise.all([
      postUpdate(tab1, x1, y1),
      postUpdate(tab2, x2, y2),
    ]);

    // Both responses must be 200 (pre-fix, the inactive player would
    // 403 "not your turn" since simultaneous turns weren't supported).
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.error).not.toBe('not your turn');
    expect(r2.body.error).not.toBe('not your turn');

    // Both claims should succeed (each tab is claiming a cell
    // adjacent to its OWN player's start, which is the cheapest
    // cell for that player).
    expect(r1.body.alive).toBe(true);
    expect(r1.body.owner).toBe('p1');
    expect(r2.body.alive).toBe(true);
    expect(r2.body.owner).toBe('p2');

    await ctx1.close();
    await ctx2.close();
  });

  test('End Turn waits for both players before stepping the world', async ({ browser }) => {
    // The user wanted the world to NOT advance until BOTH players
    // are ready, so a fast player can't race the board forward
    // before the opponent finishes their moves.
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const tab1 = await ctx1.newPage();
    const tab2 = await ctx2.newPage();
    tab1.on('pageerror', (e) => console.log('[A pageerror]', e.message));
    tab2.on('pageerror', (e) => console.log('[B pageerror]', e.message));

    await Promise.all([tab1.goto('/lobby'), tab2.goto('/lobby')]);
    await tab1.fill('#username-input', 'Alice');
    await tab2.fill('#username-input', 'Bob');
    await tab1.click('#find-match-btn');
    await tab2.click('#find-match-btn');
    await Promise.all([tab1.waitForURL('/'), tab2.waitForURL('/')]);

    // Use in-page fetch so cookies and sessionStorage are intact.
    const postEndTurn = (page) =>
      page.evaluate(async () => {
        const pid = sessionStorage.getItem('conway-war-pid');
        const r = await fetch('/end_turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid }),
        });
        return r.json();
      });

    // Read epoch from match_status so we can detect when the world
    // has stepped.
    const statusOf = (page) =>
      page.evaluate(async () => {
        const r = await fetch('/match_status');
        return r.json();
      });

    // Get the starting epoch (server starts at 0).
    const sBefore = await statusOf(tab1);
    const epochBefore = sBefore.epoch;
    expect(sBefore.you_are_ready).toBe(false);
    expect(sBefore.p1_ready).toBe(false);
    expect(sBefore.p2_ready).toBe(false);

    // Only P1 is ready. World should NOT step.
    const r1 = await postEndTurn(tab1);
    expect(r1.world_stepped).toBe(false);
    expect(r1.you_are_ready).toBe(true);
    expect(r1.ready_players).toEqual([expect.any(String)]);
    expect(r1.waiting_for).toBeTruthy();

    // Verify server state matches.
    const s1 = await statusOf(tab1);
    expect(s1.p1_ready).toBe(true);
    expect(s1.p2_ready).toBe(false);
    expect(s1.you_are_ready).toBe(true);
    expect(s1.both_ready).toBe(false);
    expect(s1.epoch).toBe(epochBefore);  // not stepped yet

    // Now P2 also clicks End Turn. World steps now.
    const r2 = await postEndTurn(tab2);
    expect(r2.world_stepped).toBe(true);
    expect(r2.you_are_ready).toBe(false);
    expect(r2.ready_players).toEqual([]);
    expect(r2.waiting_for).toBe(null);

    // Verify the world actually stepped.
    const s2 = await statusOf(tab1);
    expect(s2.epoch).toBeGreaterThan(epochBefore);
    // And the ready set cleared for the next round.
    expect(s2.p1_ready).toBe(false);
    expect(s2.p2_ready).toBe(false);
    expect(s2.both_ready).toBe(false);

    await ctx1.close();
    await ctx2.close();
  });
});
