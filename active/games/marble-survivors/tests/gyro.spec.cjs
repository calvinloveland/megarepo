// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, stepGame } = require('./helpers.cjs');

test.describe('Gyro & touch fallback', () => {
  test('touch moves the ball even when gyro is "active" but firing no events', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Simulate the "mobile, gyro auto-on, but no events" situation the user hit
    await page.evaluate(() => {
      window.G.gyroActive = true;
      window.G.gyroSupported = true;
      window.G.gyroEventsReceived = 0;
      window.G.gyroLastTime = -999;
    });
    const startX = await page.evaluate(() => window.G.player.x);
    // Touch/drag target to the right
    await page.evaluate(() => { window.G.input.targetX = 300; window.G.input.targetY = 0; });
    await stepGame(page, 1);
    const endX = await page.evaluate(() => window.G.player.x);
    expect(endX).toBeGreaterThan(startX + 50);
  });

  test('gyro input takes over once deviceorientation events fire', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.gyroActive = true;
      window.G.gyroSupported = true;
      window.G.input.targetX = 0; window.G.input.targetY = 0;
      // Ensure the gyro listener is registered (desktop test env doesn't auto-enable)
      window.addEventListener('deviceorientation', window.onGyro);
    });
    // Dispatch a synthetic deviceorientation event (tilt right)
    await page.evaluate(() => {
      const e = new Event('deviceorientation');
      e.gamma = 40; e.beta = 0;
      window.dispatchEvent(e);
    });
    const events = await page.evaluate(() => window.G.gyroEventsReceived);
    expect(events).toBeGreaterThan(0);
    const startX = await page.evaluate(() => window.G.player.x);
    await stepGame(page, 0.5);
    const endX = await page.evaluate(() => window.G.player.x);
    expect(endX).toBeGreaterThan(startX + 10);
  });

  test('gyro deadzone: small tilt produces no movement', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => window.addEventListener('deviceorientation', window.onGyro));
    await page.evaluate(() => {
      // tilt within 12° deadzone
      const e = new Event('deviceorientation');
      e.gamma = 5; e.beta = 5;
      window.dispatchEvent(e);
    });
    const input = await page.evaluate(() => ({ x: window.G.input.x, y: window.G.input.y }));
    expect(input.x).toBe(0);
    expect(input.y).toBe(0);
  });

  test('gyro deadzone: large tilt produces proportional input', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => window.addEventListener('deviceorientation', window.onGyro));
    await page.evaluate(() => {
      const e = new Event('deviceorientation');
      e.gamma = 60; e.beta = 0;
      window.dispatchEvent(e);
    });
    const input = await page.evaluate(() => window.G.input.x);
    // 60° - 12° deadzone = 48°, /60 = 0.8
    expect(input).toBeCloseTo(0.8, 1);
  });

  test('null gyro values are ignored', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => window.addEventListener('deviceorientation', window.onGyro));
    const before = await page.evaluate(() => window.G.gyroEventsReceived);
    await page.evaluate(() => {
      const e = new Event('deviceorientation');
      e.gamma = null; e.beta = null;
      window.dispatchEvent(e);
    });
    const after = await page.evaluate(() => window.G.gyroEventsReceived);
    expect(after).toBe(before);
  });
});

test.describe('Rolling texture', () => {
  test('rollAngle accumulates as the player moves', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const before = await page.evaluate(() => window.G.player.rollAngle);
    // Move the player
    await page.evaluate(() => { window.G.keys = { d: true }; });
    await stepGame(page, 0.5);
    await page.evaluate(() => { window.G.keys = {}; });
    const after = await page.evaluate(() => window.G.player.rollAngle);
    expect(after).toBeGreaterThan(before + 0.5);
  });

  test('rollAxis follows the direction of motion', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => { window.G.keys = { s: true }; }); // move down (+y)
    await stepGame(page, 0.3);
    await page.evaluate(() => { window.G.keys = {}; });
    const axis = await page.evaluate(() => window.G.player.rollAxis);
    // Moving +y → atan2(positive, 0) = PI/2
    expect(axis).toBeCloseTo(Math.PI / 2, 1);
  });

  test('textured marble renders without errors at various roll states', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const ok = await page.evaluate(() => {
      try {
        const p = window.G.player;
        for (const ra of [0, 1, 2.5, 5, 100.3]) {
          for (const ax of [0, 0.7, 1.5, 3, 4.5]) {
            p.rollAngle = ra; p.rollAxis = ax;
            p.velX = 100; p.velY = 50;
            window.render();
          }
        }
        return true;
      } catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  test('stationary marble has minimal roll accumulation', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.player.velX = 0; window.G.player.velY = 0;
      window.G.input.targetX = 0; window.G.input.targetY = 0;
    });
    const before = await page.evaluate(() => window.G.player.rollAngle);
    await stepGame(page, 0.5);
    const after = await page.evaluate(() => window.G.player.rollAngle);
    expect(Math.abs(after - before)).toBeLessThan(0.1);
  });
});
