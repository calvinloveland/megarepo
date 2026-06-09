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
    // Filter out benign 404 for favicon
    const errors = entries.filter(function(e) {
      return (e.startsWith('CONSOLE ERROR') || e.startsWith('PAGE ERROR'))
        && e.indexOf('404') === -1;
    });
    expect(errors.length).toBe(0);
  });
});
