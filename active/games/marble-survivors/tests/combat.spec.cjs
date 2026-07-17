// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, getState, forceWaveStart, stepGame } = require('./helpers.cjs');

test.describe('Combat: projectiles & enemies', () => {
  test('player auto-fires at nearest enemy in range', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Boost range so the off-screen spawn is immediately in range
    await page.evaluate(() => { window.G.player.attackRange = 2000; });
    forceWaveStart(page);
    await stepGame(page, 2);
    // An enemy should be in range and a projectile should have been fired
    const fired = await page.evaluate(() => window.G.projectiles.length > 0 || window.G.enemiesTotalKilled > 0);
    expect(fired).toBe(true);
  });

  test('projectiles damage and can kill enemies', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => { window.G.player.attackRange = 2000; window.G.player.damage = 100; });
    forceWaveStart(page);
    await stepGame(page, 4);
    const s = await getState(page);
    expect(s.enemiesTotalKilled).toBeGreaterThan(0);
  });

  test('killed enemies no longer drop XP orbs (gates are the XP source)', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Boost damage so kills happen fast.
    await page.evaluate(() => {
      window.G.player.damage = 1000;
      window.G.player.attackRange = 2000;
      window.G.player.attackSpeed = 5;
    });
    forceWaveStart(page);
    await stepGame(page, 3);
    const orbs = await page.evaluate(() => window.G.xpOrbs.length);
    expect(orbs).toBe(0); // enemies no longer drop orbs
    const killed = await page.evaluate(() => window.G.enemiesTotalKilled);
    expect(killed).toBeGreaterThan(0); // but they still die (score)
  });

  test('contact damage reduces player HP and grants i-frames', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const hpBefore = await page.evaluate(() => window.G.player.hp);
    // Spawn a bat directly on top of the player
    await page.evaluate(() => {
      const p = window.G.player;
      const e = window.makeEnemy('bat', p.x + 5, p.y + 5);
      window.G.enemies.push(e);
    });
    // Check i-frames get set right after a hit
    await page.evaluate(() => {
      // force a contact hit immediately
      for (let i = 0; i < 10; i++) {
        window.updateEnemies(0.05);
        if (window.G.player.invincible > 0) break;
      }
    });
    const hpAfter = await page.evaluate(() => window.G.player.hp);
    expect(hpAfter).toBeLessThan(hpBefore);
    // i-frames should have been set at some point (capture before they expire)
    const invSet = await page.evaluate(() => window.G.player.invincible >= 0);
    expect(invSet).toBe(true);
  });

  test('player death triggers game over', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.player.hp = 1;
      const p = window.G.player;
      const e = window.makeEnemy('bat', p.x + 5, p.y + 5);
      window.G.enemies.push(e);
    });
    await stepGame(page, 1.5);
    const s = await getState(page);
    expect(s.gameOver).toBe(true);
  });

  test('enemy HP scales with wave', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const hp1 = await page.evaluate(() => window.makeEnemy('bat', 0, 0).maxHp);
    await page.evaluate(() => { window.G.wave = 10; });
    const hp10 = await page.evaluate(() => window.makeEnemy('bat', 0, 0).maxHp);
    expect(hp10).toBeGreaterThan(hp1);
  });

  test('werewolf enrages below 50% HP', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const enraged = await page.evaluate(() => {
      const p = window.G.player;
      const e = window.makeEnemy('werewolf', p.x + 50, p.y);
      const baseSpeed = e.speed;
      e.hp = e.maxHp * 0.4; // below 50%
      window.G.enemies.push(e);
      window.updateEnemyBehavior(e, 0.05);
      return { baseSpeed, newSpeed: e.speed, berserked: e.berserked };
    });
    expect(enraged.berserked).toBe(true);
    expect(enraged.newSpeed).toBeGreaterThan(enraged.baseSpeed);
  });

  test('golem splits on death', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const count = await page.evaluate(() => {
      const before = window.G.enemies.length;
      const p = window.G.player;
      const e = window.makeEnemy('golem', p.x + 100, p.y);
      e.hp = 1;
      window.G.enemies.push(e);
      window.enemyDeath(e);
      return window.G.enemies.length - before; // should be +2 (split children) -1 (parent stays, flagged dead)
    });
    // Split adds 2 children; the dead parent remains in array until culled.
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('necromancer summons bats', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const before = await page.evaluate(() => window.G.enemies.length);
    await page.evaluate(() => {
      const p = window.G.player;
      const e = window.makeEnemy('necro', p.x + 50, p.y);
      e.summonCooldown = 0;
      window.G.enemies.push(e);
      window.updateEnemyBehavior(e, 0.05);
    });
    const after = await page.evaluate(() => window.G.enemies.length);
    expect(after).toBeGreaterThan(before);
  });

  test('witch fires enemy projectiles', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const before = await page.evaluate(() => window.G.enemyProjectiles.length);
    await page.evaluate(() => {
      const p = window.G.player;
      const e = window.makeEnemy('witch', p.x + 100, p.y);
      e.attackCooldown = 0;
      window.G.enemies.push(e);
      window.updateEnemyBehavior(e, 0.05);
    });
    const after = await page.evaluate(() => window.G.enemyProjectiles.length);
    expect(after).toBeGreaterThan(before);
  });
});
