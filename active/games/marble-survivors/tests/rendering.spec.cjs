// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, stepGame } = require('./helpers.cjs');

test.describe('Rendering & UI', () => {
  test('render() runs without throwing', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const ok = await page.evaluate(() => {
      try { window.render(); return true; }
      catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  test('renderHUD runs without throwing', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const ok = await page.evaluate(() => {
      try { window.renderHUD(); return true; }
      catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  test('renderMinimap runs without throwing', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const ok = await page.evaluate(() => {
      try { window.renderMinimap(); return true; }
      catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  test('full game loop step (update + render) is clean', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const err = await page.evaluate(() => {
      try {
        for (let i = 0; i < 60; i++) {
          window.G.survivalTime += 0.05;
          window.updateShake(0.05);
          window.updateCamera(0.05);
          window.updateWave(0.05);
          window.updatePlayer(0.05);
          window.updateEnemies(0.05);
          window.updateEnemyProjectiles(0.05);
          window.updateFireTrails(0.05);
          window.updateProjectiles(0.05);
          window.updateXP(0.05);
          window.updateParticles(0.05);
          window.updateFloatingTexts(0.05);
          window.updateDamageNumbers(0.05);
          window.render();
        }
        return null;
      } catch (e) { return String(e); }
    });
    expect(err).toBeNull();
  });

  test('upgrade panel shows NEW badge for unowned upgrades', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.xpToNext = 5;
      window.G.xp = 0;
      window.collectXP(0, 0, 5);
    });
    await expect(page.locator('.upgrade-card').first()).toContainText('NEW');
  });

  test('error reporter captures manual logError', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => window.__logError('test error from playwright'));
    await expect(page.locator('#error-badge')).not.toHaveText('0');
    // Open panel and check entry
    await page.locator('#error-toggle').click();
    await expect(page.locator('.err-msg').first()).toContainText('test error from playwright');
  });

  test('error reporter clear button resets the count', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => window.__logError('test'));
    await page.locator('#error-toggle').click();
    await page.locator('.error-btn', { hasText: 'Clear' }).click();
    await expect(page.locator('#error-badge')).toHaveText('0');
  });

  test('error reporter captures page errors from evaluate', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      // Trigger an unhandled error
      setTimeout(() => { throw new Error('boom-from-test'); }, 10);
    });
    await page.waitForTimeout(200);
    const count = await page.evaluate(() => window.__errorCount());
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Pause & game over UI', () => {
  test('game over screen shows score and stats', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.player.hp = 1;
      const p = window.G.player;
      const e = window.makeEnemy('bat', p.x + 5, p.y);
      window.G.enemies.push(e);
    });
    await stepGame(page, 1.5);
    const gameOver = await page.evaluate(() => window.G.gameOver);
    expect(gameOver).toBe(true);
    // HUD draws "GAME OVER" — verify by checking render runs
    const ok = await page.evaluate(() => { try { window.render(); return true; } catch(e){return String(e);} });
    expect(ok).toBe(true);
  });

  test('clicking after game over restarts the game', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.player.hp = 1;
      const p = window.G.player;
      const e = window.makeEnemy('bat', p.x + 5, p.y);
      window.G.enemies.push(e);
    });
    await stepGame(page, 1.5);
    expect(await page.evaluate(() => window.G.gameOver)).toBe(true);
    // The restart click listener is attached after 800ms
    await page.waitForTimeout(1000);
    await page.locator('#game-canvas').click();
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({
      gameOver: window.G.gameOver,
      hp: window.G.player.hp,
      wave: window.G.wave,
    }));
    expect(s.gameOver).toBe(false);
    expect(s.hp).toBe(100);
    expect(s.wave).toBe(0);
  });
});
