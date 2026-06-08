// @ts-check
/**
 * Comprehensive touch-gesture tests for Conway's Game of War.
 *
 * Tests use page.evaluate to create proper Touch objects via
 * `new Touch(touchInit)` so that multi-touch (pinch, rotate)
 * works reliably in Chromium.
 *
 * Console errors, page errors, and failed requests are captured
 * during each test and flushed to the Playwright output on failure.
 */
import { test, expect } from '@playwright/test';

// ─── console error reporter ───────────────────────────────────────────

/**
 * Capture page console errors, JS exceptions, and failed network requests
 * during a test and flush them to stdout if the test fails.
 *
 * Usage:
 *   test.beforeEach(({ page }) => { attachConsoleLogger(page, testInfo); });
 */
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

// ─── navigation ──────────────────────────────────────────────────────

async function goToGame(page) {
  await page.goto('/');
  await expect(page.locator('.select-card')).toBeVisible({ timeout: 5000 });
  await page.click('button[type="submit"][name="player"][value="player1"]');
  await page.waitForSelector('#game[data-bbox-xmin]', { timeout: 8000 });
  // Let initial fit + first minimap paint settle
  await page.waitForTimeout(300);
}

// ─── transform helpers ────────────────────────────────────────────────

/**
 * Parse the CSS transform on the .game-wrapper.
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

/**
 * Get the board's viewport bounding box relative to the page.
 */
async function getViewportBox(page) {
  const vp = page.locator('#viewport');
  const box = await vp.boundingBox();
  if (!box) throw new Error('viewport not found');
  return box;
}

// ─── proper touch dispatch via page.evaluate ───────────────────────────

/**
 * Dispatch a touch event on #viewport with one or more touch points.
 *
 * Uses `new Touch(init)` inside the page so that touch objects
 * have a real `target` and multi-touch (2+ fingers) works correctly.
 *
 * For `touchend`, `touches` is empty (no fingers remain on screen)
 * while `changedTouches` contains the lifted fingers.
 * For `touchstart` and `touchmove`, both lists contain the active fingers.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'touchstart'|'touchmove'|'touchend'} type
 * @param {Array<{x:number, y:number, id?:number}>} points
 * @param {'viewport'|'minimap'} [target='viewport']
 */
async function dispatchTouch(page, type, points, target = 'viewport') {
  const sel = target === 'minimap' ? '#minimap-canvas' : '#viewport';
  await page.evaluate(({ type, points, sel }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const changedTouches = points.map(p =>
      new Touch({
        identifier: p.id ?? p.x * 1000 + p.y,
        target: el,
        clientX: p.x,
        clientY: p.y,
        pageX: p.x,
        pageY: p.y,
      }),
    );
    // For touchend the active touch list is empty (fingers just lifted).
    // For touchstart/touchmove the active list is the changed list.
    const touches = type === 'touchend' ? [] : changedTouches;
    const evt = new TouchEvent(type, {
      touches,
      changedTouches,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(evt);
  }, { type, points, sel });
}

/**
 * Dispatch a complete gesture inside a single page.evaluate call
 * so that Date.now() timestamps are consistent across events.
 *
 * Events are dispatched synchronously inside the evaluate; the
 * touchend *must* come last so that _onTouchStart + _onTouchEnd
 * fire within the same JS event-loop tick.
 */
async function dispatchGesture(page, events, target = 'viewport') {
  const sel = target === 'minimap' ? '#minimap-canvas' : '#viewport';
  await page.evaluate(({ sel, events }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    for (const { type, points } of events) {
      const changedTouches = points.map(p =>
        new Touch({
          identifier: p.id ?? (p.x * 1000 + p.y + Math.random() * 1000 | 0),
          target: el,
          clientX: p.x,
          clientY: p.y,
          pageX: p.x,
          pageY: p.y,
        }),
      );
      const touches = type === 'touchend' ? [] : changedTouches;
      el.dispatchEvent(new TouchEvent(type, {
        touches,
        changedTouches,
        bubbles: true,
        cancelable: true,
      }));
    }
  }, { sel, events });
}

/**
 * Single-finger touch pan: touchstart → N touchmove steps → touchend.
 * The entire gesture is dispatched in a single evaluate call.
 */
async function touchPan(page, x1, y1, x2, y2, steps = 5) {
  const events = [
    { type: 'touchstart', points: [{ x: x1, y: y1 }] },
  ];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    events.push({
      type: 'touchmove',
      points: [{ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }],
    });
  }
  events.push({ type: 'touchend', points: [{ x: x2, y: y2 }] });
  await dispatchGesture(page, events);
}

/**
 * Two-finger pinch/spread — entire gesture in one evaluate call.
 *
 * @param {number} cx  Centre X
 * @param {number} cy  Centre Y
 * @param {number} d1  Starting spread (px between fingers)
 * @param {number} d2  Ending spread
 * @param {number} [steps=5]
 * @param {number} [angle1=0]  Starting angle (radians)
 * @param {number} [angle2=0]  Ending angle
 */
async function touchPinch(page, cx, cy, d1, d2, steps = 5, angle1 = 0, angle2 = 0) {
  const half1 = d1 / 2;
  const events = [
    {
      type: 'touchstart',
      points: [
        { x: cx + half1 * Math.cos(angle1), y: cy + half1 * Math.sin(angle1), id: 201 },
        { x: cx - half1 * Math.cos(angle1), y: cy - half1 * Math.sin(angle1), id: 202 },
      ],
    },
  ];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const dist = d1 + (d2 - d1) * t;
    const ang = angle1 + (angle2 - angle1) * t;
    const half = dist / 2;
    events.push({
      type: 'touchmove',
      points: [
        { x: cx + half * Math.cos(ang), y: cy + half * Math.sin(ang), id: 201 },
        { x: cx - half * Math.cos(ang), y: cy - half * Math.sin(ang), id: 202 },
      ],
    });
  }
  const half2 = d2 / 2;
  events.push({
    type: 'touchend',
    points: [
      { x: cx + half2 * Math.cos(angle2), y: cy + half2 * Math.sin(angle2), id: 201 },
      { x: cx - half2 * Math.cos(angle2), y: cy - half2 * Math.sin(angle2), id: 202 },
    ],
  });
  await dispatchGesture(page, events);
}

/**
 * Single tap (touchstart + touchend in one evaluate call so
 * Date.now() timing is consistent).
 */
async function touchTap(page, x, y) {
  await dispatchGesture(page, [
    { type: 'touchstart', points: [{ x, y }] },
    { type: 'touchend', points: [{ x, y }] },
  ]);
}



// ─── test suite ───────────────────────────────────────────────────────

test.describe('Touch gestures – comprehensive', () => {

  test.beforeEach(async ({ page }) => {
    await goToGame(page);
  });

  // ── 1. Single-finger pan ─────────────────────────────────────────

  test('touch pan moves the board by the correct delta', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await touchPan(page, cx, cy, cx + 60, cy + 30, 5);

    await page.waitForTimeout(100);
    const after = await getTransform(page);
    expect(after.x).toBeCloseTo(before.x + 60, -1);
    expect(after.y).toBeCloseTo(before.y + 30, -1);
  });

  test('touch pan works in the opposite direction', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await touchPan(page, cx, cy, cx - 50, cy - 25, 5);

    await page.waitForTimeout(100);
    const after = await getTransform(page);
    expect(after.x).toBeCloseTo(before.x - 50, -1);
    expect(after.y).toBeCloseTo(before.y - 25, -1);
  });

  // ── 2. Pinch zoom ───────────────────────────────────────────────

  test('pinch zoom increases scale (spread)', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Spread from 40px to 120px between fingers → zoom in
    await touchPinch(page, cx, cy, 40, 120, 8);

    await page.waitForTimeout(100);
    const after = await getTransform(page);
    expect(after.scale).toBeGreaterThan(before.scale);
  });

  test('pinch zoom decreases scale (pinch in)', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // First spread to zoom in
    await touchPinch(page, cx, cy, 40, 120, 8);
    await page.waitForTimeout(50);

    // Then pinch back to zoom out
    await touchPinch(page, cx, cy, 120, 40, 8);

    await page.waitForTimeout(100);
    const after = await getTransform(page);
    expect(after.scale).toBeLessThan(before.scale * 1.5);
  });

  test('two consecutive pinch zooms compound correctly', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // First pinch spread: 40 → 100 (2.5x distance)
    await touchPinch(page, cx, cy, 40, 100, 5);
    await page.waitForTimeout(50);
    const mid = await getTransform(page);
    expect(mid.scale).toBeGreaterThan(before.scale);

    // Second pinch spread: relative 40 → 80 (2x from new baseline)
    await touchPinch(page, cx, cy, 40, 80, 5);

    await page.waitForTimeout(100);
    const after = await getTransform(page);
    expect(after.scale).toBeGreaterThan(mid.scale);
  });

  test('pinch zoom center is stable (board shifts toward pinch point)', async ({ page }) => {
    const box = await getViewportBox(page);
    // Pinch at a point 30% from top-left (off-center)
    const cx = box.x + box.width * 0.3;
    const cy = box.y + box.height * 0.3;

    const before = await getTransform(page);

    await touchPinch(page, cx, cy, 40, 100, 8);

    await page.waitForTimeout(100);
    const after = await getTransform(page);

    // Scale increased
    expect(after.scale).toBeGreaterThan(before.scale);
    // Because the zoom center is off-center, the board position should shift
    const xShifted = Math.abs(after.x - before.x) > 2;
    const yShifted = Math.abs(after.y - before.y) > 2;
    expect(xShifted || yShifted).toBeTruthy();
  });

  // ── 4. Tap to click ─────────────────────────────────────────────

  test('tap on a toggleable cell dispatches a click', async ({ page }) => {
    // Find a toggleable cell near Player 1's start
    // In the initial state, the bbox is around (20,20).
    // Cells at (21,20) have friendly neighbors and are toggleable.
    const cellInfo = await page.evaluate(() => {
      const game = document.getElementById('game');
      if (!game) return null;
      const cellPx = parseInt(game.getAttribute('data-cell-px')) || 12;
      // Player 1 immortal is at (20,20). The viewport bbox initial-fit
      // puts cells ~(17-23, 17-23) on screen.  Cell (21,20) should be
      // toggleable.  We can find it by looking at the table rows.
      const rows = game.querySelectorAll('tr');
      // The board starts at row 0, col 0.
      // In the rendered table, row index = y, cell index = x.
      const row20 = rows[20];
      if (!row20) return null;
      const cell21_20 = row20.children[21];
      if (!cell21_20) return null;
      const rect = cell21_20.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        initialBg: cell21_20.style.backgroundColor,
      };
    });

    expect(cellInfo).not.toBeNull();
    const { x, y, initialBg } = cellInfo;
    // The cell at (21,20) starts with background rgb(50,50,50) (dead, no owner)
    // or rgb(50,65,50) (dead with slight crop level)
    // After clicking, it should change (become owned by P1, alive).

    await touchTap(page, x, y);
    await page.waitForTimeout(500); // wait for HTMX swap

    const newBg = await page.evaluate(() => {
      const game = document.getElementById('game');
      if (!game) return null;
      const rows = game.querySelectorAll('tr');
      const row = rows[20];
      if (!row) return null;
      return row.children[21]?.style.backgroundColor;
    });

    // The cell should have changed now that it's alive and owned by P1
    // (from grey/green-ish to red-ish)
    expect(newBg).not.toBe(initialBg);
  });

  // ── 5. Minimap touch drag ───────────────────────────────────────

  test('dragging on the minimap pans the board', async ({ page }) => {
    await page.waitForTimeout(1500);
    const minimapCanvas = page.locator('#minimap-canvas');
    await expect(minimapCanvas).toBeVisible({ timeout: 3000 });

    const before = await getTransform(page);
    const box = await minimapCanvas.boundingBox();
    if (!box) throw new Error('minimap canvas not found');

    // Drag on the minimap canvas
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const touchId = 500;

    const moves = 5;
    const mmEvents = [
      { type: 'touchstart', points: [{ x: cx, y: cy, id: touchId }] },
    ];
    for (let i = 1; i <= moves; i++) {
      const t = i / moves;
      mmEvents.push({
        type: 'touchmove',
        points: [{ x: cx + 50 * t, y: cy + 30 * t, id: touchId }],
      });
    }
    mmEvents.push({ type: 'touchend', points: [{ x: cx + 50, y: cy + 30, id: touchId }] });
    await dispatchGesture(page, mmEvents, 'minimap');

    await page.waitForTimeout(200);
    const after = await getTransform(page);

    // Board position SHOULD have changed (minimap drag pans the playfield)
    expect(after.x).not.toBeCloseTo(before.x, 0);
    expect(after.y).not.toBeCloseTo(before.y, 0);

    // Also verify that the viewport's gesture handler did NOT also fire
    // (touching minimap should only affect playfield via minimap handler)
    // Check that gesture state is clean
    const gestureClean = await page.evaluate(() => {
      const gv = window.__gameView;
      return gv ? gv._gesture === null : null;
    });
    expect(gestureClean).toBe(true);
  });

  // ── 7. Pan → pinch transition ───────────────────────────────────

  test('pan then pinch works correctly', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Start with a pan
    await touchPan(page, cx, cy, cx + 40, cy + 20, 3);
    await page.waitForTimeout(50);
    const afterPan = await getTransform(page);
    expect(afterPan.x).toBeCloseTo(before.x + 40, 0);

    // Pinch from the panned position — zoom center is at the finger midpoint,
    // which is offset from viewport center, so position shifts.
    await touchPinch(page, cx + 40, cy + 20, 40, 100, 5);

    await page.waitForTimeout(100);
    const afterPinch = await getTransform(page);
    // Scale must have increased
    expect(afterPinch.scale).toBeGreaterThan(afterPan.scale);
    // Position should not be reset to initial (pan state carried forward)
    expect(afterPinch.x).not.toBeCloseTo(before.x, 0);
    expect(afterPinch.y).not.toBeCloseTo(before.y, 0);
  });

  // ── 8. Pinch → pan transition ───────────────────────────────────

  test('pinch then pan works correctly', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // First pinch zoom in
    await touchPinch(page, cx, cy, 40, 100, 5);
    await page.waitForTimeout(50);
    const afterPinch = await getTransform(page);
    expect(afterPinch.scale).toBeGreaterThan(before.scale);

    // Then pan from the zoomed state
    await touchPan(page, cx, cy, cx + 30, cy + 15, 3);

    await page.waitForTimeout(100);
    const afterPan = await getTransform(page);

    // Scale should be preserved from the pinch
    expect(afterPan.scale).toBeCloseTo(afterPinch.scale, 1);
    // Position should have moved from the pinched position
    expect(afterPan.x).toBeCloseTo(afterPinch.x + 30, 0);
    expect(afterPan.y).toBeCloseTo(afterPinch.y + 15, 0);
  });

  // ── 9. Multiple consecutive pinch gestures ──────────────────────

  test('three consecutive pinch gestures compound', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Zoom in three times
    for (let i = 0; i < 3; i++) {
      await touchPinch(page, cx, cy, 40, 100, 5);
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(100);
    const after = await getTransform(page);
    const scaleRatio = after.scale / before.scale;
    expect(scaleRatio).toBeGreaterThan(3);
  });

  // ── 10. Tap-vs-drag discrimination ──────────────────────────────

  test('small touch movement (< 8px) does NOT move the board', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 5px movement — below 8px threshold
    await touchPan(page, cx, cy, cx + 5, cy + 3, 3);

    await page.waitForTimeout(100);
    const after = await getTransform(page);

    // Position should NOT have changed (threshold gates both _touchMoved AND position update)
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('touch movement above threshold IS treated as a drag', async ({ page }) => {
    const before = await getTransform(page);
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 10px movement — above 8px threshold
    await touchPan(page, cx, cy, cx + 10, cy + 6, 3);

    await page.waitForTimeout(100);
    const after = await getTransform(page);

    expect(after.x).toBeCloseTo(before.x + 10, 0);
    expect(after.y).toBeCloseTo(before.y + 6, 0);
  });

  // ── 11. State persistence across HTMX ───────────────────────────

  test('touch pan state persists after HTMX board swap', async ({ page }) => {
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await touchPan(page, cx, cy, cx + 80, cy + 40, 5);
    await page.waitForTimeout(100);
    const afterPan = await getTransform(page);

    // Wait for an HTMX swap (game updates every 1s)
    await page.waitForTimeout(1500);

    const afterSwap = await getTransform(page);
    expect(afterSwap.x).toBeCloseTo(afterPan.x, 0);
    expect(afterSwap.y).toBeCloseTo(afterPan.y, 0);
    expect(afterSwap.scale).toBeCloseTo(afterPan.scale, 2);
  });

  // ── 12. Reset view after touch gestures ─────────────────────────

  test('reset view (0 key) works after touch pan and pinch', async ({ page }) => {
    const box = await getViewportBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Pan
    await touchPan(page, cx, cy, cx - 60, cy - 30, 5);
    await page.waitForTimeout(50);

    // Pinch zoom
    await touchPinch(page, cx, cy, 40, 90, 5);
    await page.waitForTimeout(50);

    // Reset
    await page.keyboard.press('0');
    await page.waitForTimeout(300);

    const after = await getTransform(page);
    expect(after.rotate).toBe(0);
    expect(after.scale).toBeLessThanOrEqual(1);
  });
});
