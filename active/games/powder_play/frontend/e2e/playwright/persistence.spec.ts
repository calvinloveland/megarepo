import { test, expect } from '@playwright/test';
import { loadMaterialByName } from './helpers/materials';
import { createFailureLogger } from './helpers/failure_logger';

// Paint, let sim run, paint again, ensure new paint wasn't overwritten by an old snapshot
test('paint persists after simulation runs and additional painting', async ({ page }, testInfo) => {
  const logger = createFailureLogger(testInfo, page);
  let failed = false;
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('text=Alchemist Powder');

    await loadMaterialByName(page, 'Sand');

    // paint point A near bottom so it won't drift away
    await page.evaluate(() => (window as any).__paintGridPoints?.([{x:75,y:80}]));
    // wait for grid_set to be processed and UI to render
    await page.waitForFunction(() => (window as any).__lastGridSample !== undefined, { timeout: 2000 });
    // capture initial sand count after first paint
    const initialCount = await page.evaluate(() => {
      const lg = (window as any).__lastGrid as Uint16Array | undefined;
      const map = (window as any).__materialIdByName || {};
      const sandId = map['Sand'];
      if (!lg || !sandId) return 0;
      let c = 0;
      for (let i=0;i<lg.length;i++) if (lg[i] === sandId) c++;
      return c;
    });

    // step sim for 20 ticks
    for (let i=0;i<20;i++) await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));
    await page.waitForTimeout(200);

    // paint point B nearby
    await page.evaluate(() => (window as any).__paintGridPoints?.([{x:80,y:80}]));
    // wait for B to be visible
    await page.waitForFunction(() => (window as any).__lastGridSample !== undefined, { timeout: 2000 });
    await page.waitForTimeout(200);

    // step a few more
    for (let i=0;i<5;i++) await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));
    await page.waitForTimeout(200);

    // ensure the second paint increases sand count (i.e., not overwritten by stale grid)
    const afterCount = await page.evaluate(() => {
      const lg = (window as any).__lastGrid as Uint16Array | undefined;
      const map = (window as any).__materialIdByName || {};
      const sandId = map['Sand'];
      if (!lg || !sandId) return 0;
      let c = 0;
      for (let i=0;i<lg.length;i++) if (lg[i] === sandId) c++;
      return c;
    });

    logger.log('sand count before/after', initialCount, afterCount);
    expect(afterCount).toBeGreaterThan(initialCount);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});