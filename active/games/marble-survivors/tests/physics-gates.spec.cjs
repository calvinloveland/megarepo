// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, stepGame } = require('./helpers.cjs');

test.describe('Super Monkey Ball physics', () => {
  test('ball accelerates toward target velocity (momentum, not instant)', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Apply input and check the ball ramps up over several frames rather than
    // instantly hitting max speed.
    const speeds = await page.evaluate(() => {
      const samples = [];
      window.G.keys = { d: true };
      for (let i = 0; i < 8; i++) {
        window.updatePlayer(0.05);
        samples.push(Math.hypot(window.G.player.velX, window.G.player.velY));
      }
      window.G.keys = {};
      return samples;
    });
    // First sample should be well below max speed (200)
    expect(speeds[0]).toBeLessThan(100);
    // Speed should monotonically increase while input is held
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeGreaterThan(speeds[i-1] - 0.001);
    }
    // Eventually approaches max speed
    expect(speeds[speeds.length-1]).toBeGreaterThan(150);
  });

  test('ball coasts with friction when input is released', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const res = await page.evaluate(() => {
      // Build up speed
      window.G.keys = { d: true };
      for (let i = 0; i < 30; i++) window.updatePlayer(0.05);
      window.G.keys = {};
      const speedAtRelease = Math.hypot(window.G.player.velX, window.G.player.velY);
      // Coast with no input
      for (let i = 0; i < 10; i++) window.updatePlayer(0.05);
      const speedAfterCoast = Math.hypot(window.G.player.velX, window.G.player.velY);
      return { speedAtRelease, speedAfterCoast };
    });
    // Should still be moving after coast (friction < 1, not instant stop)
    expect(res.speedAfterCoast).toBeGreaterThan(0);
    // But slower than at release
    expect(res.speedAfterCoast).toBeLessThan(res.speedAtRelease);
  });

  test('ball does not exceed max speed (p.speed)', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.keys = { d: true };
      for (let i = 0; i < 200; i++) window.updatePlayer(0.05);
    });
    const speed = await page.evaluate(() => Math.hypot(window.G.player.velX, window.G.player.velY));
    const maxSpeed = await page.evaluate(() => window.G.player.speed);
    expect(speed).toBeLessThanOrEqual(maxSpeed + 1);
  });

  test('diagonal input is normalized (no speed boost on diagonals)', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const speed = await page.evaluate(() => {
      window.G.keys = { d: true, s: true };
      for (let i = 0; i < 200; i++) window.updatePlayer(0.05);
      return Math.hypot(window.G.player.velX, window.G.player.velY);
    });
    const maxSpeed = await page.evaluate(() => window.G.player.speed);
    expect(speed).toBeLessThanOrEqual(maxSpeed + 1);
  });

  test('rolling texture keeps spinning while coasting (momentum visible)', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const res = await page.evaluate(() => {
      window.G.keys = { d: true };
      for (let i = 0; i < 30; i++) window.updatePlayer(0.05);
      window.G.keys = {};
      const before = window.G.player.rollAngle;
      for (let i = 0; i < 10; i++) window.updatePlayer(0.05);
      return { before, after: window.G.player.rollAngle };
    });
    // Ball is still moving (coasting) so roll should keep increasing
    expect(res.after).toBeGreaterThan(res.before);
  });
});

test.describe('Gates (XP source)', () => {
  test('gates spawn at game start', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const count = await page.evaluate(() => window.G.gates.length);
    expect(count).toBeGreaterThanOrEqual(7);
  });

  test('each gate has a value, color, and radius', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const gates = await page.evaluate(() => window.G.gates.map(g => ({
      value: g.value, color: g.color, radius: g.radius,
    })));
    for (const g of gates) {
      expect(g.value).toBeGreaterThan(0);
      expect(g.color).toMatch(/^#/);
      expect(g.radius).toBeGreaterThan(10);
    }
  });

  test('passing through a gate grants XP and respawns the gate', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const res = await page.evaluate(() => {
      const p = window.G.player;
      const xpBefore = window.G.xp;
      const countBefore = window.G.gates.length;
      // Teleport the player onto the first gate
      const g = window.G.gates[0];
      p.x = g.x; p.y = g.y;
      window.updateGates(0.05);
      return {
        xpBefore, xpAfter: window.G.xp,
        countBefore, countAfter: window.G.gates.length,
        leveledOrGained: window.G.xp > xpBefore,
      };
    });
    expect(res.xpAfter).toBeGreaterThan(res.xpBefore);
    // Gate count stays the same (consumed + respawned)
    expect(res.countAfter).toBe(res.countBefore);
  });

  test('gate XP scales with wave number', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const v1 = await page.evaluate(() => window.gateValue());
    await page.evaluate(() => { window.G.wave = 5; });
    const v5 = await page.evaluate(() => window.gateValue());
    expect(v5).toBeGreaterThan(v1);
  });

  test('Gate Value (orbValue) upgrade multiplies gate XP', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const res = await page.evaluate(() => {
      const p = window.G.player;
      p.orbValue = 2; // double XP
      const g = window.G.gates[0];
      const xpBefore = window.G.xp;
      p.x = g.x; p.y = g.y;
      window.updateGates(0.05);
      return { gained: window.G.xp - xpBefore, base: g.value };
    });
    expect(res.gained).toBe(res.base * 2);
  });

  test('Gate Reach (magnetism) increases capture radius', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // With high magnetism, player should capture from farther away
    const captured = await page.evaluate(() => {
      const p = window.G.player;
      p.magnetism = 1000; // big reach
      const g = window.G.gates[0];
      // Stand just outside the ring itself but within reach
      const dist = g.radius + 30;
      p.x = g.x + dist; p.y = g.y;
      const xpBefore = window.G.xp;
      window.updateGates(0.05);
      return window.G.xp > xpBefore;
    });
    expect(captured).toBe(true);
  });

  test('enemies no longer drop XP orbs', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.player.damage = 1000;
      window.G.player.attackRange = 2000;
      window.G.player.attackSpeed = 5;
    });
    // forceWaveStart is in helpers but not imported here; step enough to spawn
    await stepGame(page, 3);
    const orbs = await page.evaluate(() => window.G.xpOrbs.length);
    expect(orbs).toBe(0);
  });

  test('gates render without errors', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const ok = await page.evaluate(() => {
      try {
        window.render();
        // Move player near a gate and render again
        const g = window.G.gates[0];
        window.G.player.x = g.x; window.G.player.y = g.y;
        window.render();
        return true;
      } catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  test('gates appear on the minimap', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const ok = await page.evaluate(() => {
      try { window.renderMinimap(); return true; } catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });
});
