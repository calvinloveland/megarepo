import { test, expect } from '@playwright/test';
import { createFailureLogger } from './helpers/failure_logger';

// Paint sand, run simulation, and ensure number of sand cells stays the same.
test('sand count is conserved after steps', async ({ page }, testInfo) => {
  const logger = createFailureLogger(testInfo, page);
  let failed = false;
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('text=Alchemist Powder');

    // Load Sand
    const sandRow = page.locator('#materials-list > div', { hasText: 'Sand' }).first();
    await sandRow.click();
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Sand'), { timeout: 2000 });

    // Paint a small cluster of sand points
    const points = [] as {x:number,y:number}[];
    for (let y=5; y<9; y++) {
      for (let x=70; x<75; x++) points.push({x,y});
    }
    await page.evaluate((pts) => (window as any).__paintGridPoints?.(pts), points);

    // Wait for grid to render
    await page.waitForFunction(() => (window as any).__lastGrid && (window as any).__lastGridWidth, { timeout: 2000 });

    const beforeCount = await page.evaluate(() => {
      const lg = (window as any).__lastGrid as Uint16Array;
      let c = 0;
      for (let i=0;i<lg.length;i++) if (lg[i] > 0) c++;
      return c;
    });

    // Run the simulation for 30 ticks
    for (let i=0;i<30;i++) {
      await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));
    }
    await page.waitForTimeout(200);

    const afterCount = await page.evaluate(() => {
      const lg = (window as any).__lastGrid as Uint16Array;
      let c = 0;
      for (let i=0;i<lg.length;i++) if (lg[i] > 0) c++;
      return c;
    });

    logger.log('sand count before/after', beforeCount, afterCount);
    expect(afterCount).toBe(beforeCount);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});
