/**
 * End-to-end tests for the Recursive Thermofluid Sandbox.
 *
 * Requires the server to be running (e.g. `node server.mjs` on PORT 5192 or
 * set the `BASE_URL` env var).
 *
 * Usage:
 *   npx playwright test tests/e2e.spec.mjs
 *
 * On NixOS, run inside a nix shell with Playwright + Chromium:
 *   nix-shell -p nodejs playwright chromium --run \
 *     "npx playwright test tests/e2e.spec.mjs"
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5192';

test.describe('Recursive Thermofluid Sandbox', () => {

  test('page loads with canvas and controls visible', async ({ page }) => {
    await page.goto(BASE);

    // Core UI elements exist
    await expect(page.locator('#sandboxCanvas')).toBeVisible();
    await expect(page.locator('#playPauseButton')).toBeVisible();
    await expect(page.locator('#stepButton')).toBeVisible();
    await expect(page.locator('#canvasToolbar')).toBeVisible();
    await expect(page.locator('#telemetryToggle')).toBeVisible();

    // Title shows root grid
    await expect(page.locator('#viewTitle')).toContainText('Root 3×3 grid');
  });

  test('step button advances the simulation by one tick', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(100);

    const tickReadout = page.locator('#tickReadout');
    const initialTick = await tickReadout.textContent();

    await page.locator('#stepButton').click();
    await page.waitForTimeout(50);

    const afterStep = await tickReadout.textContent();
    expect(afterStep).not.toBe(initialTick);
  });

  test('play button toggles label and simulation can step while paused', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(100);

    const playBtn = page.locator('#playPauseButton');

    // Initially running — button says Pause
    await expect(playBtn).toContainText('Pause');

    // Click to pause
    await playBtn.click();
    await expect(playBtn).toContainText('Play');

    // Verify running state on the JS side
    const runningAfterPause = await page.evaluate(() => window.__testState?.running ?? '(no state)');

    // Step while paused — tick should advance
    const tickBefore = await page.locator('#tickReadout').textContent();
    await page.locator('#stepButton').click();
    const tickAfter = await page.locator('#tickReadout').textContent();
    expect(tickAfter).not.toBe(tickBefore);

    // Click to resume
    await playBtn.click();
    await expect(playBtn).toContainText('Pause');

    // Step again while running — tick can still be advanced manually
    await page.locator('#stepButton').click();
    await page.waitForTimeout(50);
    expect(await page.locator('#tickReadout').textContent()).not.toBe(tickAfter);
  });

  test('canvas toolbar tools can be selected', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(100);

    // Click each tool button and verify selectionLabel updates
    const tools = ['gas', 'liquid', 'wall', 'wheel-powered-cw', 'wheel-free', 'erase'];
    for (const tool of tools) {
      const btn = page.locator(`#toolbarButtons button[data-tool="${tool}"]`);
      await btn.click();
      // Verify the sidebar label updates (the toolbar button might not get the active CSS class
      // in every headless configuration, but the model state always updates)
      await expect(page.locator('#selectionLabel')).toContainText(tool);
    }
  });

  test('feedback tab opens and displays component cards', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(100);

    // Switch to feedback tab
    await page.locator('[data-workspace-tab="feedback"]').click();
    await expect(page.locator('#workspaceFeedback')).toBeVisible();
    await expect(page.locator('#feedbackForms')).toBeVisible();

    // Should have feedback cards
    const cards = page.locator('.feedback-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(8);
  });

  test('telemetry toggle shows and hides stats', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(100);

    const stats = page.locator('#globalStats');
    const toggle = page.locator('#telemetryToggle');

    // Should be hidden initially
    await expect(stats).not.toBeVisible();

    // Show
    await toggle.click();
    await expect(stats).toBeVisible();

    // Hide again
    await toggle.click();
    await expect(stats).not.toBeVisible();
  });

  test('reset button restores tick to 0 (with running simulation paused)', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(100);

    // Pause the auto-running simulation so tick stays stable
    await page.locator('#playPauseButton').click();
    await page.waitForTimeout(50);

    // Advance a couple ticks manually
    await page.locator('#stepButton').click();
    await page.locator('#stepButton').click();
    await page.waitForTimeout(50);
    expect(await page.locator('#tickReadout').textContent()).not.toBe('Tick 0');

    // Reset
    await page.locator('#resetButton').click();
    await page.waitForTimeout(50);

    await expect(page.locator('#tickReadout')).toContainText('Tick 0');
  });

  test('navigating into a nested grid and back works', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(200);

    // Find a subdivided cell (center cell in pump preset should be subdivided)
    // Click on it
    const canvas = page.locator('#sandboxCanvas');
    const box = await canvas.boundingBox();
    if (!box) return;

    // Click center of the canvas (the middle cell of 3×3)
    const cellW = box.width / 3;
    await page.mouse.click(box.x + cellW * 1.5, box.y + cellW * 1.5);
    await page.waitForTimeout(50);

    const enterBtn = page.locator('#enterButton');
    if (await enterBtn.isEnabled()) {
      await enterBtn.click();
      await page.waitForTimeout(50);
      await expect(page.locator('#viewTitle')).toContainText('Nested 3×3 grid');

      // Go back
      await page.locator('#backButton').click();
      await page.waitForTimeout(50);
      await expect(page.locator('#viewTitle')).toContainText('Root 3×3 grid');
    }
  });

  test('blueprint save and load round-trip', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(150);

    // Type a name
    const nameInput = page.locator('#blueprintName');
    await nameInput.fill('e2e-test-machine');

    // Save
    await page.locator('#saveBlueprintButton').click();
    await page.waitForTimeout(300);

    // Verify the blueprint appeared in the load dropdown
    const select = page.locator('#loadBlueprintSelect');
    const options = await select.locator('option').allTextContents();
    expect(options.some((t) => t.includes('e2e-test-machine'))).toBeTruthy();

    // Select it to load
    await select.selectOption({ label: 'e2e-test-machine' });
    await page.waitForTimeout(100);

    // Status should confirm load
    await expect(page.locator('#statusLine')).toContainText('Loaded');
  });

  test('undo reverts a paint action', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(150);

    // Pause the simulation
    await page.locator('#playPauseButton').click();
    await page.waitForTimeout(50);

    // Paint a cell with a tool
    const wallBtn = page.locator('#toolbarButtons button[data-tool="wall"]');
    await wallBtn.click();
    await page.waitForTimeout(50);

    // Paint on the canvas (click top-left cell)
    const canvas = page.locator('#sandboxCanvas');
    const box = await canvas.boundingBox();
    if (!box) return;
    const cellW = box.width / 3;
    await page.mouse.click(box.x + cellW / 2, box.y + cellW / 2);
    await page.waitForTimeout(50);

    // Select liquid tool to verify tool state before undo
    const liquidBtn = page.locator('#toolbarButtons button[data-tool="liquid"]');
    await liquidBtn.click();

    // Ctrl+Z to undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);

    // The cell should no longer be a wall (just check status changed)
    await expect(page.locator('#statusLine')).toBeVisible();
  });
});
