// Shared helpers for the Blood Marble test suite.
// The game exposes its state on `window.G` and key functions on `window`,
// which makes it directly testable from Playwright via page.evaluate.

const { expect } = require('@playwright/test');

// Wait until the game has initialized (canvas sized, player spawned).
async function waitForGameReady(page) {
  await page.waitForFunction(() => {
    return window.G && window.G.player && window.G.W > 0 && window.G.H > 0 && typeof window.gameLoop === 'function';
  }, { timeout: 8000 });
}

// Snapshot of core state, evaluated in the page.
async function getState(page) {
  return page.evaluate(() => {
    const p = window.G.player;
    if (!p) return null;
    return {
      hp: p.hp,
      maxHp: p.maxHp,
      level: window.G.level,
      xp: window.G.xp,
      xpToNext: window.G.xpToNext,
      wave: window.G.wave,
      waveState: window.G.waveState,
      score: window.G.score,
      survivalTime: window.G.survivalTime,
      enemies: window.G.enemies.length,
      projectiles: window.G.projectiles.length,
      xpOrbs: window.G.xpOrbs.length,
      gameOver: window.G.gameOver,
      paused: window.G.paused,
      showingUpgrades: window.G.showingUpgrades,
      enemiesTotalKilled: window.G.enemiesTotalKilled,
      playerX: p.x,
      playerY: p.y,
      worldW: window.WORLD_W || 3000,
      worldH: window.WORLD_H || 3000,
      upgrades: { ...window.G.upgradeLevels },
      gyroActive: window.G.gyroActive,
    };
  });
}

// Collect console + page errors during navigation.
function attachErrorCollector(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));
  return {
    consoleErrors,
    pageErrors,
    assertClean: () => {
      expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
      expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
    },
  };
}

// Force the wave to start immediately by zeroing the wave timer.
async function forceWaveStart(page) {
  await page.evaluate(() => {
    window.G.waveTimer = 0;
    window.G.waveState = 'idle';
  });
}

// Advance the in-game clock by stepping the loop many times with a fixed dt.
// We do this by calling the update functions directly to avoid rAF timing.
async function stepGame(page, seconds, dt = 0.05) {
  const steps = Math.round(seconds / dt);
  await page.evaluate(({ steps, dt }) => {
    for (let i = 0; i < steps; i++) {
      if (window.G.gameOver || window.G.paused) break;
      window.G.survivalTime += dt;
      window.updateShake(dt);
      window.updateCamera(dt);
      window.updateWave(dt);
      window.updatePlayer(dt);
      window.updateEnemies(dt);
      window.updateEnemyProjectiles(dt);
      window.updateFireTrails(dt);
      window.updateProjectiles(dt);
      window.updateXP(dt);
      window.updateParticles(dt);
      window.updateFloatingTexts(dt);
      window.updateDamageNumbers(dt);
    }
  }, { steps, dt });
}

module.exports = {
  waitForGameReady,
  getState,
  attachErrorCollector,
  forceWaveStart,
  stepGame,
};
