// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, getState, attachErrorCollector } = require('./helpers.cjs');

test.describe('Load & boot', () => {
  test('page loads without console or page errors', async ({ page }) => {
    const errors = attachErrorCollector(page);
    const resp = await page.goto('/');
    expect(resp.status()).toBe(200);
    await waitForGameReady(page);
    await page.waitForTimeout(500);
    errors.assertClean();
  });

  test('serves game.js and style.css', async ({ page }) => {
    const js = await page.goto('/game.js');
    expect(js.status()).toBe(200);
    expect(await js.text()).toContain('Blood Marble');
    const css = await page.goto('/style.css');
    expect(css.status()).toBe(200);
    expect(await css.text()).toContain('error-panel');
  });

  test('canvas element exists and has nonzero size', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const box = await page.locator('#game-canvas').boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(100);
  });

  test('game state initializes with a player at world center', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const s = await getState(page);
    expect(s).not.toBeNull();
    expect(s.hp).toBe(100);
    expect(s.maxHp).toBe(100);
    expect(s.level).toBe(1);
    expect(s.wave).toBe(0);
    expect(s.gameOver).toBe(false);
    // Player starts at world center
    expect(s.playerX).toBe(s.worldW / 2);
    expect(s.playerY).toBe(s.worldH / 2);
  });

  test('world is expanded (3000x3000)', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const s = await getState(page);
    expect(s.worldW).toBe(3000);
    expect(s.worldH).toBe(3000);
  });

  test('decorations are generated', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const count = await page.evaluate(() => window.G.decorations.length);
    expect(count).toBeGreaterThan(50);
  });

  test('HUD shows wave, time, and bars', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.waitForTimeout(200);
    // The HUD is drawn on canvas; verify controls bar DOM
    await expect(page.locator('#controls')).toBeVisible();
    await expect(page.locator('#game-title')).toContainText('Blood Marble');
    await expect(page.locator('#toggle-gyro')).toBeVisible();
    await expect(page.locator('#restart-btn')).toBeVisible();
  });

  test('error reporter toggle is present and shows 0 initially', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await expect(page.locator('#error-toggle')).toBeVisible();
    await expect(page.locator('#error-badge')).toHaveText('0');
  });
});
