import { test, expect } from '@playwright/test';
import { createFailureLogger } from './helpers/failure_logger';

// Sand should sink through water; oil should float above water.
test('materials settle by density (sand sinks, oil floats)', async ({ page }, testInfo) => {
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
    await loadByName('Oil');
    await loadByName('Sand');

    await page.evaluate(() => {
      const map = (window as any).__materialIdByName || {};
      const worker = (window as any).__powderWorker;
      if (!worker) return;
      const waterId = map['Water'];
      const oilId = map['Oil'];
      const sandId = map['Sand'];
      if (!waterId || !oilId || !sandId) return;

      const waterPoints = [] as {x:number,y:number}[];
      for (let y=40; y<75; y++) {
        for (let x=60; x<90; x++) waterPoints.push({x,y});
      }
      const oilPoints = [] as {x:number,y:number}[];
      for (let y=30; y<36; y++) {
        for (let x=60; x<90; x++) oilPoints.push({x,y});
      }
      const sandPoints = [] as {x:number,y:number}[];
      for (let y=20; y<26; y++) {
        for (let x=70; x<80; x++) sandPoints.push({x,y});
      }

      worker.postMessage({type:'paint_points', materialId: waterId, points: waterPoints});
      worker.postMessage({type:'paint_points', materialId: oilId, points: oilPoints});
      worker.postMessage({type:'paint_points', materialId: sandId, points: sandPoints});
    });

    // Wait for grid to render
    await page.waitForFunction(() => (window as any).__lastGrid && (window as any).__lastGridWidth, { timeout: 2000 });

    // Run the simulation for enough ticks to settle
    for (let i=0;i<200;i++) {
      await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));
    }
    await page.waitForTimeout(200);

    const ordering = await page.evaluate(() => {
      const lg = (window as any).__lastGrid as Uint16Array | undefined;
      const w = (window as any).__lastGridWidth || 150;
      const h = w ? Math.floor(lg.length / w) : 0;
      const map = (window as any).__materialIdByName || {};
      const oilId = map['Oil'];
      const waterId = map['Water'];
      const sandId = map['Sand'];
      if (!lg || !oilId || !waterId || !sandId) return null;

      let validColumns = 0;
      let sample: {oilY:number, waterY:number, sandY:number} | null = null;
      for (let x=65; x<=85; x++) {
        let oilY = -1;
        let waterY = -1;
        let sandY = -1;
        for (let y=0; y<h; y++) {
          const v = lg[y * w + x];
          if (oilY < 0 && v === oilId) {
            oilY = y;
            continue;
          }
          if (oilY >= 0 && waterY < 0 && v === waterId) {
            waterY = y;
            continue;
          }
          if (waterY >= 0 && v === sandId) {
            sandY = y;
            break;
          }
        }
        if (oilY >= 0 && waterY >= 0 && sandY >= 0 && oilY < waterY && waterY < sandY) {
          validColumns++;
          if (!sample) sample = {oilY, waterY, sandY};
        }
      }
      return { validColumns, sample };
    });

    expect(ordering).not.toBeNull();
    expect(ordering!.validColumns).toBeGreaterThan(0);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});
