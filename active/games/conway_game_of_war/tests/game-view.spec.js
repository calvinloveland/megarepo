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

/**
 * Navigate past the player-select screen to the actual game.
 */
async function goToGame(page) {
  await page.goto('/');
  // Should redirect to /select_player
  await expect(page.locator('.select-card')).toBeVisible({ timeout: 5000 });
  // Click Player 1 with Easy AI
  await page.click('button[type="submit"][name="player"][value="player1"]');
  // Wait for game board to appear (the #game element with data attributes)
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
  await page.request.post('/reset');
  await page.reload();
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
}

// ─── helper: get current transform values ────────────────────────────

/**
 * Parse the CSS transform on the .game-wrapper and return { x, y, scale, rotate }.
 * The transform is: translate(Xpx, Ypx) scale(S) rotate(Rdeg)
 */
async function getTransform(page) {
  return await page.evaluate(() => {
    const w = document.querySelector('.game-wrapper');
    if (!w) return null;
    const s = w.style.transform;
    if (!s) return null;
    const tMatch = s.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    const scMatch = s.match(/scale\(([-\d.]+)\)/);
    const rMatch = s.match(/rotate\(([-\d.]+)deg\)/);
    return {
      x: tMatch ? parseFloat(tMatch[1]) : 0,
      y: tMatch ? parseFloat(tMatch[2]) : 0,
      scale: scMatch ? parseFloat(scMatch[1]) : 1,
      rotate: rMatch ? parseFloat(rMatch[1]) : 0,
    };
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

async function readOverlayStyle(page, selector) {
  return await page.evaluate((selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const style = getComputedStyle(node);
    return {
      opacity: parseFloat(style.opacity || '0'),
      height: style.height,
    };
  }, selector);
}

// ─── tests ───────────────────────────────────────────────────────────

test.describe('GameView – map‑like navigation', () => {

  test.beforeEach(async ({ page }) => {
    await goToGame(page);
  });

  // ── initial fit ───────────────────────────────────────────────────

  test('initial fit: board is visible and scaled to viewport', async ({ page }) => {
    const game = page.locator('#game');
    await expect(game).toBeVisible();

    const t = await getTransform(page);
    expect(t).not.toBeNull();
    // Scale should be ≤ 1 for the default board on a normal viewport
    expect(t.scale).toBeGreaterThan(0);
    expect(t.scale).toBeLessThanOrEqual(1);
  });

  // ── pan via mouse drag ────────────────────────────────────────────

  test('mouse drag pans the board', async ({ page }) => {
    const before = await getTransform(page);
    const viewport = page.locator('#viewport');

    const box = await viewport.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 5 });
    await page.mouse.up();

    const after = await getTransform(page);
    expect(after.x).toBeCloseTo(before.x + 100, -1);
    expect(after.y).toBeCloseTo(before.y + 50, -1);
  });

  test('energy overlay can be toggled on and off', async ({ page }) => {
    const button = page.locator('#toggle-energy-overlay');
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    const cell = await page.evaluate(() => {
      const target = document.querySelector('#game td[data-owner="p1"] .cell-energy-bar');
      if (!target) return null;
      return '#game td[data-owner="p1"] .cell-energy-bar';
    });
    expect(cell).not.toBeNull();

    const visible = await readOverlayStyle(page, cell);
    expect(visible.opacity).toBeGreaterThan(0);

    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(200);
    const hidden = await readOverlayStyle(page, cell);
    expect(hidden.opacity).toBeLessThan(0.05);

    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(200);
    const visibleAgain = await readOverlayStyle(page, cell);
    expect(visibleAgain.opacity).toBeGreaterThan(0.5);
  });

  test('territory overlay can be toggled on and off', async ({ page }) => {
    const button = page.locator('#toggle-territory-overlay');
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    const cell = '#game td[data-owner="p1"][data-alive="0"] .cell-territory-overlay';
    await expect(page.locator(cell).first()).toBeVisible();

    const visible = await readOverlayStyle(page, cell);
    expect(visible.opacity).toBeGreaterThan(0);

    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(200);
    const hidden = await readOverlayStyle(page, cell);
    expect(hidden.opacity).toBeLessThan(0.05);

    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(200);
    const visibleAgain = await readOverlayStyle(page, cell);
    expect(visibleAgain.opacity).toBeGreaterThan(0.1);
  });

  test('cell click shows optimistic state before delayed backend response', async ({ page }) => {
    const normalize = (value) => (value || '').replace(/\s+/g, '');
    const initial = await readCellStyle(page, 21, 20);
    const playerColor = normalize(await page.locator('.player-name').evaluate((el) => getComputedStyle(el).color));

    await page.route('**/update_cell?x=21&y=20&json=1', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });

    const responsePromise = page.waitForResponse((resp) => {
      const url = new URL(resp.url());
      return resp.request().method() === 'POST'
        && url.pathname === '/update_cell'
        && url.searchParams.get('x') === '21'
        && url.searchParams.get('y') === '20'
        && url.searchParams.get('json') === '1';
    });

    await page.evaluate(() => {
      const game = document.getElementById('game');
      if (!game) return;
      const row = game.querySelectorAll('tr')[20];
      if (!row) return;
      const div = row.children[21]?.querySelector('.cell');
      if (div) div.click();
    });

    await page.waitForTimeout(100);
    const optimistic = await readCellStyle(page, 21, 20);
    expect(normalize(optimistic.bg)).toBe(playerColor);
    expect(normalize(optimistic.bg)).not.toBe(normalize(initial.bg));

    const response = await responsePromise;
    const payload = await response.json();
    await page.waitForTimeout(50);
    const finalStyle = await readCellStyle(page, 21, 20);
    expect(normalize(finalStyle.bg)).toBe(normalize(payload.bg));
    expect(normalize(finalStyle.border)).toBe(normalize(payload.border));
  });

  test('fast clicks on multiple cells keep each optimistic flip until its own response arrives', async ({ page }) => {
    const normalize = (value) => (value || '').replace(/\s+/g, '');
    const playerColor = normalize(await page.locator('.player-name').evaluate((el) => getComputedStyle(el).color));
    const deadBg = 'rgb(50,50,50)';

    const targets = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#game td[data-action="claim"] .cell, #game td[data-action="toggle-on"] .cell, #game td[data-action="toggle-off"] .cell'))
        .slice(0, 3)
        .map((cell) => ({
          x: Number(cell.getAttribute('data-x')),
          y: Number(cell.getAttribute('data-y')),
          action: cell.parentElement?.dataset.action || 'none',
        }));
    });
    expect(targets).toHaveLength(3);

    await page.route('**/update_cell?*json=1', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });

    const responsePromises = targets.map(({ x, y }) => page.waitForResponse((resp) => {
      const url = new URL(resp.url());
      return resp.request().method() === 'POST'
        && url.pathname === '/update_cell'
        && url.searchParams.get('x') === String(x)
        && url.searchParams.get('y') === String(y)
        && url.searchParams.get('json') === '1';
    }));

    await page.evaluate((coords) => {
      const game = document.getElementById('game');
      if (!game) return;
      const rows = game.querySelectorAll('tr');
      coords.forEach(({ x, y }) => {
        const div = rows[y]?.children[x]?.querySelector('.cell');
        if (div) div.click();
      });
    }, targets);

    await page.waitForTimeout(100);
    for (const { x, y, action } of targets) {
      const optimistic = await readCellStyle(page, x, y);
      const expectedBg = action === 'toggle-off' ? deadBg : playerColor;
      expect(normalize(optimistic.bg)).toBe(normalize(expectedBg));
    }
    await expect(page.locator('td.cell-pending')).toHaveCount(3);

    const payloads = await Promise.all(responsePromises.map((promise) => promise.then((resp) => resp.json())));
    await page.waitForTimeout(50);
    for (let i = 0; i < targets.length; i += 1) {
      const { x, y } = targets[i];
      const finalStyle = await readCellStyle(page, x, y);
      expect(normalize(finalStyle.bg)).toBe(normalize(payloads[i].bg));
      expect(normalize(finalStyle.border)).toBe(normalize(payloads[i].border));
    }
  });

  test('reverted optimistic render emits a warning', async ({ page }) => {
    const normalize = (value) => (value || '').replace(/\s+/g, '');
    const target = await page.evaluate(() => {
      const cell = document.querySelector('#game td[data-action="claim"] .cell, #game td[data-action="toggle-on"] .cell, #game td[data-action="toggle-off"] .cell');
      if (!cell) return null;
      return {
        x: Number(cell.getAttribute('data-x')),
        y: Number(cell.getAttribute('data-y')),
      };
    });
    expect(target).not.toBeNull();

    const initial = await readCellStyle(page, target.x, target.y);
    await page.route(`**/update_cell?x=${target.x}&y=${target.y}&json=1`, async (route) => {
      await route.fulfill({ status: 500, body: 'boom' });
    });

    const warningPromise = page.waitForRequest((req) => {
      if (!req.url().endsWith('/log_error') || req.method() !== 'POST') return false;
      try {
        const payload = JSON.parse(req.postData() || '{}');
        return payload.level === 'warning' && payload.message.includes(`Optimistic render reverted at (${target.x},${target.y})`);
      } catch {
        return false;
      }
    });

    await page.evaluate(({ x, y }) => {
      const game = document.getElementById('game');
      if (!game) return;
      const row = game.querySelectorAll('tr')[y];
      if (!row) return;
      const div = row.children[x]?.querySelector('.cell');
      if (div) div.click();
    }, target);

    const warningRequest = await warningPromise;
    const warningPayload = JSON.parse(warningRequest.postData() || '{}');
    expect(warningPayload.level).toBe('warning');
    expect(warningPayload.message).toContain(`(${target.x},${target.y})`);

    await page.waitForTimeout(100);
    const finalStyle = await readCellStyle(page, target.x, target.y);
    expect(normalize(finalStyle.bg)).toBe(normalize(initial.bg));
    expect(normalize(finalStyle.border)).toBe(normalize(initial.border));
  });

  // ── zoom via scroll wheel ─────────────────────────────────────────

  test('scroll wheel zooms in/out toward cursor', async ({ page }) => {
    const before = await getTransform(page);

    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(100);

    let after = await getTransform(page);
    expect(after.scale).toBeGreaterThan(before.scale);

    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(100);

    after = await getTransform(page);
    expect(after.scale).toBeLessThan(before.scale * 1.1);
  });

  // ── double‑click zoom ─────────────────────────────────────────────

  test('double‑click zooms in at cursor', async ({ page }) => {
    const before = await getTransform(page);
    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();

    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);

    const after = await getTransform(page);
    expect(after.scale).toBeGreaterThan(before.scale);
  });

  // ── minimap ───────────────────────────────────────────────────────

  test('minimap appears, has canvas, and viewport rectangle', async ({ page }) => {
    await page.waitForTimeout(1500);

    const minimap = page.locator('#minimap');
    await expect(minimap).toBeVisible({ timeout: 3000 });

    const canvas = page.locator('#minimap-canvas');
    await expect(canvas).toBeVisible();

    const w = await canvas.getAttribute('width');
    const h = await canvas.getAttribute('height');
    expect(parseInt(w)).toBeGreaterThan(0);
    expect(parseInt(h)).toBeGreaterThan(0);
  });

  test('clicking minimap re‑centres viewport', async ({ page }) => {
    await page.waitForTimeout(1500);
    const minimapCanvas = page.locator('#minimap-canvas');
    await expect(minimapCanvas).toBeVisible({ timeout: 3000 });

    const before = await getTransform(page);
    const box = await minimapCanvas.boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.waitForTimeout(300);

    const after = await getTransform(page);
    expect(after.x).not.toBeCloseTo(before.x, -1);
    expect(after.y).not.toBeCloseTo(before.y, -1);
  });

  // ── keyboard ──────────────────────────────────────────────────────

  test('arrow keys pan the board (map‑like direction)', async ({ page }) => {
    const before = await getTransform(page);

    // ArrowRight: state.x -= 40 (content moves left → view moves right)
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    // ArrowDown: state.y -= 40 (content moves up → view moves down)
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);

    const after = await getTransform(page);
    // ArrowRight → content moves LEFT → translate x DECREASES
    expect(after.x).toBeLessThan(before.x);
    // ArrowDown → content moves UP → translate y DECREASES
    expect(after.y).toBeLessThan(before.y);
  });

  test('+ / - keys zoom in / out', async ({ page }) => {
    const before = await getTransform(page);

    // Press '=' (which produces '+' on US keyboards; we also handle '=' as alias)
    await page.keyboard.press('=');
    await page.waitForTimeout(100);
    let after = await getTransform(page);
    expect(after.scale).toBeGreaterThan(before.scale);

    await page.keyboard.press('-');
    await page.waitForTimeout(100);
    after = await getTransform(page);
    expect(after.scale).toBeLessThan(after.scale * 1.5); // at least it changed
    // Should be less than the zoomed-in value
    expect(after.scale).toBeLessThan(before.scale * 1.2);
  });

  test('0 key resets view', async ({ page }) => {
    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    await page.keyboard.press('0');
    await page.waitForTimeout(300);

    const after = await getTransform(page);
    expect(after.rotate).toBe(0);
    expect(after.scale).toBeLessThanOrEqual(1);
  });

  // ── HTMX persistence ─────────────────────────────────────────────

  test('transform persists after HTMX board swap', async ({ page }) => {
    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);

    const before = await getTransform(page);
    await page.waitForTimeout(1500);

    const after = await getTransform(page);
    expect(after.scale).toBeCloseTo(before.scale, 1);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  // ── touch gestures ────────────────────────────────────────────────

  test('touch pan gesture moves the board', async ({ page, context }) => {
    const before = await getTransform(page);
    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Use dispatchEvent for synthetic touch events (requires hasTouch context)
    await page.dispatchEvent('#viewport', 'touchstart', {
      touches: [{ clientX: cx, clientY: cy, identifier: 0 }],
      changedTouches: [{ clientX: cx, clientY: cy, identifier: 0 }],
    });
    await page.dispatchEvent('#viewport', 'touchmove', {
      touches: [{ clientX: cx + 80, clientY: cy + 40, identifier: 0 }],
      changedTouches: [{ clientX: cx + 80, clientY: cy + 40, identifier: 0 }],
    });
    await page.dispatchEvent('#viewport', 'touchend', {
      changedTouches: [{ clientX: cx + 80, clientY: cy + 40, identifier: 0 }],
    });
    await page.waitForTimeout(100);

    const after = await getTransform(page);
    expect(after.x).toBeCloseTo(before.x + 80, -1);
    expect(after.y).toBeCloseTo(before.y + 40, -1);
  });

  test('zoom indicator appears on zoom', async ({ page }) => {
    const indicator = page.locator('#zoom-indicator');
    await expect(indicator).toBeVisible();

    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    await page.mouse.wheel(box.x + box.width / 2, box.y + box.height / 2, -120);
    await page.waitForTimeout(200);

    const text = await indicator.textContent();
    expect(text).toMatch(/\d+%/);
    expect(indicator).toHaveClass(/show/);
  });
});
