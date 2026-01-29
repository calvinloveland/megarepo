import { test, expect } from '@playwright/test';
import { createFailureLogger } from './helpers/failure_logger';

// Paint water, run simulation, and ensure number of water cells stays the same.
test('water count is conserved after long steps', async ({ page }, testInfo) => {
  const logger = createFailureLogger(testInfo, page);
  let failed = false;
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('text=Alchemist Powder');

    const loadByName = async (name: string) => {
      const nameMatcher = new RegExp(`^${name}$`);
      const row = page.locator('#materials-list > div').filter({ has: page.locator('strong', { hasText: nameMatcher }) }).first();
      if (await row.count() === 0) {
        await page.locator('#show-all-materials').check();
        await row.first().waitFor({ state: 'visible' });
      }
      await row.click();
      await page.waitForFunction((n) => document.getElementById('status')?.textContent?.includes(n), name, { timeout: 2000 });
    };

    await loadByName('Water');

    // Paint a larger block of water points
    const points = [] as {x:number,y:number}[];
    for (let y=5; y<20; y++) {
      for (let x=60; x<90; x++) points.push({x,y});
    }
    await page.evaluate((pts) => (window as any).__paintGridPoints?.(pts), points);

    // Wait for grid to render
    await page.waitForFunction(() => (window as any).__lastGrid && (window as any).__lastGridWidth, { timeout: 2000 });

    const beforeCount = await page.evaluate(() => {
      const lg = (window as any).__lastGrid as Uint16Array;
      const map = (window as any).__materialIdByName || {};
      const waterId = map['Water'];
      if (!waterId) return 0;
      let c = 0;
      for (let i=0;i<lg.length;i++) if (lg[i] === waterId) c++;
      return c;
    });

    // Run the simulation for 200 ticks
    for (let i=0;i<200;i++) {
      await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));
    }
    await page.waitForTimeout(200);

    const afterCount = await page.evaluate(() => {
      const lg = (window as any).__lastGrid as Uint16Array;
      const map = (window as any).__materialIdByName || {};
      const waterId = map['Water'];
      if (!waterId) return 0;
      let c = 0;
      for (let i=0;i<lg.length;i++) if (lg[i] === waterId) c++;
      return c;
    });

    logger.log('water count before/after', beforeCount, afterCount);
    expect(afterCount).toBe(beforeCount);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});
