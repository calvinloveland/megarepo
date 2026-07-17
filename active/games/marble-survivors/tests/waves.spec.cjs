// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, getState, forceWaveStart, stepGame } = require('./helpers.cjs');

test.describe('Wave system', () => {
  test('wave starts after idle countdown', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    forceWaveStart(page);
    await stepGame(page, 0.2);
    const s = await getState(page);
    expect(s.wave).toBe(1);
    expect(s.waveState).toBe('active');
  });

  test('enemies spawn during active wave', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    forceWaveStart(page);
    await stepGame(page, 2);
    const s = await getState(page);
    expect(s.wave).toBe(1);
    expect(s.enemies).toBeGreaterThan(0);
  });

  test('wave enemy count scales with wave number', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Force wave 1
    await page.evaluate(() => { window.G.waveTimer = 0; window.G.waveState = 'idle'; });
    await stepGame(page, 0.1);
    const w1 = await page.evaluate(() => window.G.enemiesThisWave);
    // Force wave 5
    await page.evaluate(() => {
      window.G.wave = 4;
      window.G.waveState = 'waiting';
      window.G.waveTimer = 0;
      window.G.enemies = [];
      window.G.enemiesSpawned = window.G.enemiesThisWave;
    });
    await stepGame(page, 1.5);
    const w5 = await page.evaluate(() => window.G.enemiesThisWave);
    expect(w5).toBeGreaterThan(w1);
  });

  test('boss wave triggers every 5 waves', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    // Jump to wave 4, then trigger next wave (wave 5 = boss)
    await page.evaluate(() => {
      window.G.wave = 4;
      window.G.waveState = 'idle';
      window.G.waveTimer = 0;
      window.G.enemies = [];
    });
    await stepGame(page, 0.2);
    const isBossWave = await page.evaluate(() => window.G.wave % 5 === 0);
    expect(isBossWave).toBe(true);
    // Boss should eventually appear
    await stepGame(page, 5);
    const hasBoss = await page.evaluate(() => window.G.enemies.some(e => e.isBoss));
    expect(hasBoss).toBe(true);
  });

  test('enemy types unlock progressively', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const w1 = await page.evaluate(() => window.availableEnemies(1).length);
    const w5 = await page.evaluate(() => window.availableEnemies(5).length);
    const w10 = await page.evaluate(() => window.availableEnemies(10).length);
    expect(w1).toBeLessThan(w5);
    expect(w5).toBeLessThan(w10);
    expect(w1).toBe(1); // only bats at wave 1
    expect(w10).toBeGreaterThanOrEqual(10); // all types by wave 10
  });

  test('wave clear grants bonus XP', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const xpBefore = await page.evaluate(() => window.G.xp);
    forceWaveStart(page);
    // Kill all enemies instantly and let wave complete
    await page.evaluate(() => {
      window.G.waveTimer = 0; window.G.waveState = 'idle';
    });
    await stepGame(page, 0.2); // start wave 1
    await stepGame(page, 2);    // spawn enemies
    // Mark all spawned, kill all enemies
    await page.evaluate(() => {
      window.G.enemiesSpawned = window.G.enemiesThisWave;
      window.G.enemies.forEach(e => { e.hp = 1; });
      // one-shot kill via thorns-free direct damage
      window.G.enemies = [];
    });
    await stepGame(page, 0.5);
    const xpAfter = await page.evaluate(() => window.G.xp);
    // Should have gained at least the wave-clear bonus
    expect(xpAfter).toBeGreaterThan(xpBefore);
  });
});
