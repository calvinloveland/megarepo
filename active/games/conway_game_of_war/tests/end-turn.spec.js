// @ts-check
/**
 * End Turn / step animation tests.
 */
import { test, expect } from '@playwright/test';

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

async function goToGame(page) {
  await page.goto('/');
  await expect(page.locator('.select-card')).toBeVisible({ timeout: 5000 });
  await page.click('button[type="submit"][name="player"][value="player1"]');
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
  await page.request.post('/reset');
  await page.reload();
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
  await page.waitForTimeout(300);
}

async function seedScenario(page, name) {
  const response = await page.request.post('/__test__/seed_scenario', {
    form: { name },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.scenario).toBe(name);
  await page.reload();
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
  await page.waitForTimeout(300);
}

async function clickEndTurn(page) {
  const btn = page.locator('#end-turn-btn');
  await btn.click();
  await expect(btn).toHaveText('⏭ End Turn', { timeout: 30000 });
  await page.waitForTimeout(100);
}

async function clickReset(page) {
  await page.click('button[hx-post="/reset"]');
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
  await page.waitForTimeout(300);
}

async function getFibRemaining(page) {
  return await page.evaluate(() => {
    const game = document.getElementById('game');
    if (!game) return -1;
    const r = game.getAttribute('data-fib-remaining');
    return r ? parseInt(r, 10) : 0;
  });
}

async function readCellStyle(page, x, y) {
  return await page.evaluate(({ x, y }) => {
    const game = document.getElementById('game');
    if (!game) return null;
    const rows = game.querySelectorAll('tr');
    const row = rows[y];
    if (!row) return null;
    const cell = row.children[x];
    if (!cell) return null;
    return {
      bg: cell.style.backgroundColor,
      border: cell.style.borderColor,
    };
  }, { x, y });
}

async function toggleCell(page, x, y) {
  const responsePromise = page.waitForResponse((resp) => {
    const url = new URL(resp.url());
    return resp.request().method() === 'POST'
      && url.pathname === '/update_cell'
      && url.searchParams.get('x') === String(x)
      && url.searchParams.get('y') === String(y)
      && url.searchParams.get('json') === '1'
      && resp.status() === 200;
  });

  await page.evaluate(({ x, y }) => {
    const game = document.getElementById('game');
    if (!game) return;
    const rows = game.querySelectorAll('tr');
    const row = rows[y];
    if (!row) return;
    const td = row.children[x];
    if (!td) return;
    const div = td.querySelector('.cell');
    if (div) div.click();
  }, { x, y });

  const response = await responsePromise;
  const payload = await response.json();
  await page.waitForFunction(({ x, y, bg, border }) => {
    const normalize = (value) => (value || '').replace(/\s+/g, '');
    const game = document.getElementById('game');
    if (!game) return false;
    const rows = game.querySelectorAll('tr');
    const row = rows[y];
    if (!row) return false;
    const cell = row.children[x];
    if (!cell) return false;
    return normalize(cell.style.backgroundColor) === normalize(bg)
      && normalize(cell.style.borderColor) === normalize(border);
  }, payload);
  return payload;
}

async function getToggleableCells(page, count) {
  return await page.evaluate((count) => {
    return Array.from(document.querySelectorAll('#game td[data-action="claim"] .cell, #game td[data-action="toggle-on"] .cell, #game td[data-action="toggle-off"] .cell'))
      .slice(0, count)
      .map((cell) => ({
        x: Number(cell.getAttribute('data-x')),
        y: Number(cell.getAttribute('data-y')),
        action: cell.parentElement?.dataset.action || 'none',
      }));
  }, count);
}

async function countNonDefaultCells(page) {
  return await page.evaluate(() => {
    const game = document.getElementById('game');
    if (!game) return 0;
    let count = 0;
    const rows = game.querySelectorAll('tr');
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].querySelectorAll('td');
      for (let c = 0; c < cells.length; c++) {
        if (cells[c].dataset.owner !== 'none' || cells[c].dataset.alive === '1') {
          count += 1;
        }
      }
    }
    return count;
  });
}

async function countStepRequestsDuring(page, action) {
  let count = 0;
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/step') count += 1;
  };
  page.on('request', onRequest);
  try {
    await action();
  } finally {
    page.off('request', onRequest);
  }
  return count;
}

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
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);

    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);

    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);
  });

  test('game state advances (fib-remaining resets after each turn)', async ({ page }) => {
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);
  });

  test('no JS errors during End Turn animation', async ({ page }) => {
    await clickEndTurn(page);
    const entries = consoleErrors.get(test.info().title) || [];
    const errors = entries.filter((entry) => {
      return (entry.startsWith('CONSOLE ERROR') || entry.startsWith('PAGE ERROR'))
        && !entry.includes('404');
    });
    expect(errors.length).toBe(0);
  });

  test('#game element stays live in DOM after each swap', async ({ page }) => {
    async function checkGameElement() {
      return await page.evaluate(() => {
        const game = document.getElementById('game');
        if (!game) return { ok: false, reason: 'no #game element' };
        if (!game.parentNode) return { ok: false, reason: 'detached from DOM' };
        const w = game.getAttribute('data-board-w');
        if (!w) return { ok: false, reason: 'missing data-board-w' };
        const r = game.getAttribute('data-fib-remaining');
        return {
          ok: true,
          boardW: parseInt(w, 10),
          fibRemaining: r !== null ? parseInt(r, 10) : null,
          parentTag: game.parentNode.tagName,
        };
      });
    }

    const before = await checkGameElement();
    expect(before.ok).toBe(true);
    expect(before.fibRemaining).toBe(0);
    expect(before.parentTag).toBe('DIV');
    expect(before.boardW).toBeGreaterThan(0);

    for (let i = 0; i < 4; i++) {
      await clickEndTurn(page);
      const after = await checkGameElement();
      expect(after.ok).toBe(true);
      expect(after.fibRemaining).toBe(0);
      expect(after.parentTag).toBe('DIV');
      expect(after.boardW).toBeGreaterThan(0);
    }
  });

  test('game progresses through many End Turns with placed cells', async ({ page }) => {
    test.slow();

    const coords = await getToggleableCells(page, 4);
    expect(coords).toHaveLength(4);
    for (const { x, y } of coords) {
      await toggleCell(page, x, y);
    }

    const beforeAlive = await countNonDefaultCells(page);
    console.log('Non-default cells before:', beforeAlive);
    expect(beforeAlive).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < 6; i++) {
      await clickEndTurn(page);
    }

    const afterAlive = await countNonDefaultCells(page);
    console.log('Non-default cells after 6 End Turns:', afterAlive);
    expect(afterAlive).toBeGreaterThan(0);
    expect(afterAlive).not.toBe(beforeAlive);
  });

  test('5 consecutive End Turns without stale lastRem', async ({ page }) => {
    test.slow();

    for (let i = 0; i < 5; i++) {
      await clickEndTurn(page);
    }

    expect(await getFibRemaining(page)).toBe(0);
    await expect(page.locator('#end-turn-btn')).toHaveText('⏭ End Turn');
  });

  test('frontend keeps stepping through 8 turns on a dense local setup', async ({ page }) => {
    test.slow();
    test.setTimeout(180000);

    const coords = await getToggleableCells(page, 15);
    expect(coords.length).toBeGreaterThanOrEqual(8);

    for (const { x, y } of coords) {
      await toggleCell(page, x, y);
    }

    const btn = page.locator('#end-turn-btn');
    for (let turn = 1; turn <= 8; turn++) {
      const started = Date.now();
      await clickEndTurn(page);
      const elapsed = Date.now() - started;
      const colored = await countNonDefaultCells(page);
      console.log(`turn ${turn}: ${elapsed}ms, colored=${colored}`);
      expect(await getFibRemaining(page)).toBe(0);
      await expect(btn).toHaveText('⏭ End Turn');
      expect(colored).toBeGreaterThan(0);
    }

    const entries = consoleErrors.get(test.info().title) || [];
    const errors = entries.filter((entry) => {
      return (entry.startsWith('CONSOLE ERROR') || entry.startsWith('PAGE ERROR'))
        && !entry.includes('404');
    });
    expect(errors.length).toBe(0);
  });

  test('Fibonacci turns fire the expected number of /step requests', async ({ page }) => {
    const observed = [];

    observed.push(await countStepRequestsDuring(page, async () => {
      await clickEndTurn(page);
    }));
    observed.push(await countStepRequestsDuring(page, async () => {
      await clickEndTurn(page);
    }));
    observed.push(await countStepRequestsDuring(page, async () => {
      await clickEndTurn(page);
    }));
    observed.push(await countStepRequestsDuring(page, async () => {
      await clickEndTurn(page);
    }));

    expect(observed).toEqual([0, 0, 1, 2]);
  });

  test('End Turn then Reset then End Turn works', async ({ page }) => {
    await clickEndTurn(page);
    await clickReset(page);
    expect(await getFibRemaining(page)).toBe(0);
    await clickEndTurn(page);
    expect(await getFibRemaining(page)).toBe(0);
  });

  test('territory collision scenario completes multi-step turns without swap errors', async ({ page }) => {
    test.slow();

    await seedScenario(page, 'territory_collision');

    const seededCell = await readCellStyle(page, 24, 20);
    expect(seededCell).not.toBeNull();
    expect(seededCell.bg).not.toBe('rgb(50, 65, 50)');

    const observed = [];
    for (let i = 0; i < 4; i++) {
      observed.push(await countStepRequestsDuring(page, async () => {
        await clickEndTurn(page);
      }));
    }

    expect(observed).toEqual([0, 0, 1, 2]);
    expect(await getFibRemaining(page)).toBe(0);

    const entries = consoleErrors.get(test.info().title) || [];
    const errors = entries.filter((entry) => {
      return (entry.startsWith('CONSOLE ERROR') || entry.startsWith('PAGE ERROR'))
        && !entry.includes('404');
    });
    expect(errors.length).toBe(0);
  });
});
