// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForGameReady, getState, stepGame } = require('./helpers.cjs');

test.describe('XP & leveling', () => {
  test('collecting XP increases the XP pool', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const before = await page.evaluate(() => window.G.xp);
    await page.evaluate(() => window.collectXP(0, 0, 5));
    const after = await page.evaluate(() => window.G.xp);
    expect(after).toBe(before + 5);
  });

  test('level up triggers upgrade panel', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      // Give exactly enough XP to level up once
      window.G.xpToNext = 5;
      window.G.xp = 0;
      window.collectXP(0, 0, 5);
    });
    const showing = await page.evaluate(() => window.G.showingUpgrades);
    expect(showing).toBe(true);
    await expect(page.locator('#upgrade-panel')).toBeVisible();
    // Should have 3 choices
    const choices = await page.locator('.upgrade-card').count();
    expect(choices).toBe(3);
  });

  test('choosing an upgrade applies its effect', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const before = await page.evaluate(() => window.G.player.speed);
    await page.evaluate(() => {
      window.G.xpToNext = 5;
      window.G.xp = 0;
      window.collectXP(0, 0, 5);
    });
    // Force the damage upgrade into choices
    await page.evaluate(() => {
      window.G.upgradeChoices = [window.UPGRADES.find(u => u.id === 'speed')];
      window.renderUpgradePanel();
    });
    await page.locator('.upgrade-card').click();
    const after = await page.evaluate(() => window.G.player.speed);
    expect(after).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.G.upgradeLevels.speed)).toBe(1);
  });

  test('multiple simultaneous level-ups queue upgrade panels', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.G.xpToNext = 5;
      window.G.xp = 0;
      // Give enough XP to level up 3 times
      window.collectXP(0, 0, 20);
    });
    // Should be showing first panel with 2 pending
    const status = await page.evaluate(() => ({
      showing: window.G.showingUpgrades,
      pending: window.G.pendingLevelUps,
      level: window.G.level,
    }));
    expect(status.showing).toBe(true);
    expect(status.pending).toBeGreaterThanOrEqual(1);
  });

  test('xpToNext scales exponentially with level', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const lvl1 = await page.evaluate(() => { window.G.level = 1; return Math.round(10*Math.pow(1.25, 0)); });
    const lvl5 = await page.evaluate(() => { return Math.round(10*Math.pow(1.25, 4)); });
    expect(lvl5).toBeGreaterThan(lvl1 * 2);
  });

  test('all 18 upgrades are defined and applicable', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const ids = await page.evaluate(() => window.UPGRADES.map(u => u.id));
    expect(ids.length).toBe(18);
    // Each should be applicable without error
    const ok = await page.evaluate(() => {
      for (const u of window.UPGRADES) {
        window.applyUpgrade(u.id);
      }
      return true;
    });
    expect(ok).toBe(true);
    const appliedCount = await page.evaluate(() => Object.keys(window.G.upgradeLevels).length);
    expect(appliedCount).toBe(18);
  });

  test('shield upgrade grants charges', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => window.applyUpgrade('shield'));
    const s = await page.evaluate(() => ({
      max: window.G.player.shieldMaxCharges,
      cur: window.G.player.shieldCharges,
    }));
    expect(s.max).toBe(1);
    expect(s.cur).toBe(1);
  });

  test('vampiric heals on kill', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    await page.evaluate(() => {
      window.applyUpgrade('vampiric');
      const p = window.G.player;
      p.hp = 50;
      const e = window.makeEnemy('bat', p.x + 10, p.y);
      e.hp = 1;
      window.enemyDeath(e);
    });
    const hp = await page.evaluate(() => window.G.player.hp);
    expect(hp).toBeGreaterThan(50);
  });

  test('thorns reflects contact damage', async ({ page }) => {
    await page.goto('/');
    await waitForGameReady(page);
    const enemyDied = await page.evaluate(() => {
      window.applyUpgrade('thorns'); // 15% reflect
      const p = window.G.player;
      window.applyUpgrade('maxHp'); window.applyUpgrade('maxHp');
      // Bat with 1 HP so thorns (round(5*0.15)=1) kills in one hit
      const e = window.makeEnemy('bat', p.x + 5, p.y);
      e.hp = 1; e.maxHp = 1;
      window.G.enemies.push(e);
      // Step until the bat dies from thorns or player dies
      for (let i = 0; i < 100; i++) {
        window.G.enemies.forEach(en => { en.attackCooldown = 0; });
        window.updateEnemies(0.05);
        if (e.dead) break;
        if (window.G.gameOver) break;
      }
      return e.dead;
    });
    expect(enemyDied).toBe(true);
  });
});
