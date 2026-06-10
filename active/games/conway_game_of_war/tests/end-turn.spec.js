// @ts-check
/**
 * End Turn / step animation tests.
 *
 * The table itself carries hx-post="/step" hx-trigger="load delay:80ms"
 * when more steps remain.  No hidden divs — no DOM accumulation.
 */
import { test, expect } from '@playwright/test';

// ─── console error reporter ───────────────────────────────────────────

const consoleErrors = new Map();

test.beforeEach(({ page }, testInfo) => {
  const entries = [];
  consoleErrors.set(testInfo.title, entries);
  page.on('console', (msg) => {
    if (msg.type() === 'error') entries.push(`CONSOLE ERROR: ${msg.text()}`);
  });
  page.on('pageerror', (err) => entries.push(`PAGE ERROR: ${err.message}\n${err.stack}`));
  page.on('requestfailed', (req) => entries.push(
    `REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText ?? 'unknown'}`,
  ));
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

// ─── helpers ───────────────────────────────────────────────────────────

async function goToGame(page) {
  await page.goto('/');
  await expect(page.locator('.select-card')).toBeVisible({ timeout: 5000 });
  await page.click('button[type="submit"][name="player"][value="player1"]');
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
  await page.waitForTimeout(300);
}

/**
 * Click End Turn and wait for the animation to finish.
 * The button is managed by JS (animating flag).  We wait for the
 * button to return to '⏭ End Turn'.
 */
async function clickEndTurn(page) {
  const btn = page.locator('#end-turn-btn');
  await btn.click();
  await expect(btn).toHaveText('⏭ End Turn', { timeout: 30000 });
  await page.waitForTimeout(100);
}

/**
 * Read data-fib-remaining from the current #game element.
 */
async function getFibRemaining(page) {
  return await page.evaluate(() => {
    const game = document.getElementById('game');
    if (!game) return -1;
    const r = game.getAttribute('data-fib-remaining');
    return r ? parseInt(r, 10) : 0;
  });
}

// ─── tests ─────────────────────────────────────────────────────────────

test.describe('End Turn animation', () => {

  test.beforeEach(async ({ page }) => {
    await goToGame(page);
  });

  test('End Turn progresses the game (cells present after turn)', async ({ page }) => {
    const before = await page.evaluate(() => {
      const game = document.getElementById('game');
      return game ? game.querySelectorAll('td').length : 0;
    });

    await clickEndTurn(page);

    const afterCells = await page.evaluate(() => {
      const game = document.getElementById('game');
      return game ? game.querySelectorAll('td').length : 0;
    });
    expect(afterCells).toBe(before);
  });

  test('data-fib-remaining reaches 0 after animation completes', async ({ page }) => {
    // First End Turn: fib(1)=1 → remaining=0
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);

    // Second End Turn: fib(1)=1 → remaining=0
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);

    // Third End Turn: fib(2)=2 → remaining=1 during, then 0 after
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);
  });

  test('game state advances (fib-remaining resets after each turn)', async ({ page }) => {
    // After any End Turn, data-fib-remaining should return to 0
    // (indicating the animation completed properly)
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);
  });

  test('no JS errors during End Turn animation', async ({ page }) => {
    await clickEndTurn(page);
    const entries = consoleErrors.get(test.info().title) || [];
    const errors = entries.filter(function(e) {
      return (e.startsWith('CONSOLE ERROR') || e.startsWith('PAGE ERROR'))
        && e.indexOf('404') === -1;
    });
    expect(errors.length).toBe(0);
  });

  test('#game element stays live in DOM after each swap', async ({ page }) => {
    async function checkGameElement() {
      return await page.evaluate(() => {
        var game = document.getElementById('game');
        if (!game) return { ok: false, reason: 'no #game element' };
        if (!game.parentNode) return { ok: false, reason: 'detached from DOM' };
        var w = game.getAttribute('data-board-w');
        if (!w) return { ok: false, reason: 'missing data-board-w' };
        var r = game.getAttribute('data-fib-remaining');
        return {
          ok: true,
          boardW: parseInt(w, 10),
          fibRemaining: r !== null ? parseInt(r, 10) : null,
          parentTag: game.parentNode.tagName,
        };
      });
    }

    // Before any End Turns
    var before = await checkGameElement();
    expect(before.ok).toBe(true);
    expect(before.fibRemaining).toBe(0);
    expect(before.parentTag).toBe('DIV');
    expect(before.boardW).toBeGreaterThan(0);

    // 4 End Turns: fib(1)+fib(1)+fib(2)+fib(3) = 7 steps
    for (var i = 0; i < 4; i++) {
      await clickEndTurn(page);

      var after = await checkGameElement();
      expect(after.ok).toBe(true);
      expect(after.fibRemaining).toBe(0);
      expect(after.parentTag).toBe('DIV');
      expect(after.boardW).toBeGreaterThan(0);
    }
  });

  test('game progresses through many End Turns with placed cells', async ({ page }) => {
    // Place a 2x2 block (stable still-life in GoL) near the start area.
    // Coordinates: start is at (20,20), territory covers (19,19)-(21,21).
    // Cells at (23,23)-(24,24) are outside territory but can be claimed
    // via clicking (they have friendly neighbours via territory chain).
    // Actually, let's just click cells that are already owned territory
    // to activate them — those are at (19,19)-(21,21) area.

    async function clickCell(x, y) {
      await page.evaluate(({x, y}) => {
        var game = document.getElementById('game');
        if (!game) return;
        var rows = game.querySelectorAll('tr');
        var row = rows[y];
        if (!row) return;
        var td = row.children[x];
        if (!td) return;
        var div = td.querySelector('.cell');
        if (div) div.click();
      }, {x, y});
      // Wait for the JSON cell update to process
      await page.waitForTimeout(400);
    }

    // Create a 2x2 block at (19,20), (19,21), (20,20), (20,21)
    // where (20,20) is immortal already — let's place it elsewhere
    // Use territory cells at (19,19), (19,20), (20,19), (20,20)
    // Actually (20,20) is the immortal start, can't toggle it.
    // Let's use (21,19), (21,20), (22,19), (22,20) — these are owned
    // territory from the start cell's neighbour claim.

    // Toggle them alive via click (free since they're owned)
    await clickCell(21, 19);  // wait for response
    await clickCell(21, 20);
    await clickCell(22, 19);
    await clickCell(22, 20);

    await page.waitForTimeout(200);

    async function countColored() {
      return await page.evaluate(() => {
        var game = document.getElementById('game');
        if (!game) return 0;
        var count = 0;
        var rows = game.querySelectorAll('tr');
        for (var r = 0; r < rows.length; r++) {
          var cells = rows[r].querySelectorAll('td');
          for (var c = 0; c < cells.length; c++) {
            var bg = cells[c].style.backgroundColor;
            if (bg && bg.indexOf('rgb(50, 65, 50)') === -1) count++;
          }
        }
        return count;
      });
    }

    var beforeAlive = await countColored();
    console.log('Non-default cells before:', beforeAlive);
    expect(beforeAlive).toBeGreaterThanOrEqual(5);

    // 6 End Turns: fib(1)+fib(1)+fib(2)+fib(3)+fib(5)+fib(8) = 20 ticks
    for (var i = 0; i < 6; i++) {
      await clickEndTurn(page);
    }

    var afterAlive = await countColored();
    console.log('Non-default cells after 6 End Turns:', afterAlive);

    // Game should still have cells (didn't crash)
    expect(afterAlive).toBeGreaterThan(0);
    // The game should be in a different state than initial
    // (either more cells from GoL expansion, or fewer from decay)
    expect(afterAlive).not.toBe(beforeAlive);
  }, 120000);  // 2 minute timeout for 8 turns with auto-steps
});

  test('5 consecutive End Turns without stale lastRem', async ({ page }) => {
    for (var i = 0; i < 5; i++) {
      await clickEndTurn(page);
    }
    expect(await getFibRemaining(page)).toBe(0);
  });

  test('multi-step turn auto-steps complete', async ({ page }) => {
    // Turns 1-2: fib=1 (0 auto-steps)
    await clickEndTurn(page);
    await clickEndTurn(page);

    // Turn 3: fib=2 (1 auto-step)
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);
  });

  test('End Turn then Reset then End Turn works', async ({ page }) => {
    await clickEndTurn(page);
    await page.click('button[hx-post="/reset"]');
    await page.waitForTimeout(500);
    expect(await getFibRemaining(page)).toBe(0);
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);
  });
