// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, getState, stepGame } = require('./helpers.cjs');

test.describe('Controls & camera', () => {
  test('keyboard WASD moves the player', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const before = await page.evaluate(() => ({ x: window.G.player.x, y: window.G.player.y }));
    // Hold D (right) and step
    await page.evaluate(() => { window.G.keys = { d: true }; });
    await stepGame(page, 0.5);
    await page.evaluate(() => { window.G.keys = {}; });
    const after = await page.evaluate(() => ({ x: window.G.player.x, y: window.G.player.y }));
    expect(after.x).toBeGreaterThan(before.x);
  });

  test('keyboard arrow keys move the player', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const before = await page.evaluate(() => window.G.player.y);
    await page.evaluate(() => { window.G.keys = { ArrowDown: true }; });
    await stepGame(page, 0.5);
    await page.evaluate(() => { window.G.keys = {}; });
    const after = await page.evaluate(() => window.G.player.y);
    expect(after).toBeGreaterThan(before);
  });

  test('mouse move steers the player', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Move mouse to the right edge of the canvas
    const box = await page.locator('#game-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5);
    const before = await page.evaluate(() => window.G.player.x);
    await stepGame(page, 0.5);
    const after = await page.evaluate(() => window.G.player.x);
    expect(after).toBeGreaterThan(before);
  });

  test('player is clamped to world bounds', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Push the player far left
    await page.evaluate(() => {
      window.G.player.x = 5;
      window.G.player.y = 5;
      window.updatePlayer(0.05);
    });
    const s = await getState(page);
    expect(s.playerX).toBeGreaterThanOrEqual(20);
    expect(s.playerY).toBeGreaterThanOrEqual(20);
  });

  test('camera follows the player', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Move player far from center
    await page.evaluate(() => {
      window.G.player.x = 2500;
      window.G.player.y = 2500;
    });
    // Step camera
    await page.evaluate(() => { for (let i=0;i<60;i++) window.updateCamera(0.05); });
    const cam = await page.evaluate(() => ({ x: window.G.cam.x, y: window.G.cam.y }));
    expect(cam.x).toBeGreaterThan(2000);
    expect(cam.y).toBeGreaterThan(2000);
  });

  test('camera clamps at world edges', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.player.x = 10;
      window.G.player.y = 10;
      for (let i=0;i<60;i++) window.updateCamera(0.05);
    });
    const cam = await page.evaluate(() => ({ x: window.G.cam.x, y: window.G.cam.y, w: window.G.W, h: window.G.H }));
    // Half-width from edge
    expect(cam.x).toBeGreaterThanOrEqual(cam.w/2 - 1);
    expect(cam.y).toBeGreaterThanOrEqual(cam.h/2 - 1);
  });

  test('P key pauses the game', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.keyboard.press('p');
    const paused = await page.evaluate(() => window.G.paused);
    expect(paused).toBe(true);
    await page.keyboard.press('p');
    const paused2 = await page.evaluate(() => window.G.paused);
    expect(paused2).toBe(false);
  });

  test('Space pauses the game', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.keyboard.press('Space');
    const paused = await page.evaluate(() => window.G.paused);
    expect(paused).toBe(true);
  });

  test('gyro toggle button switches modes', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const initial = await page.evaluate(() => window.G.gyroActive);
    await page.locator('#toggle-gyro').click();
    const after = await page.evaluate(() => window.G.gyroActive);
    expect(after).toBe(!initial);
  });

  test('restart button resets the game', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Mess up the state
    await page.evaluate(() => {
      window.G.wave = 99;
      window.G.score = 9999;
      window.G.enemiesTotalKilled = 9999;
    });
    await page.locator('#restart-btn').click();
    await page.waitForTimeout(200);
    const s = await getState(page);
    expect(s.wave).toBe(0);
    expect(s.score).toBe(0);
    expect(s.enemiesTotalKilled).toBe(0);
  });

  test('gyro input only applies when gyroActive', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // With gyro off (default on desktop), input.x should not affect movement
    await page.evaluate(() => {
      window.G.gyroActive = false;
      window.G.input.x = 1; window.G.input.y = 0;
    });
    const before = await page.evaluate(() => window.G.player.x);
    await stepGame(page, 0.3);
    const after = await page.evaluate(() => window.G.player.x);
    // Should not have moved due to gyro input (mouse target is centered)
    expect(Math.abs(after - before)).toBeLessThan(50);
  });
});
