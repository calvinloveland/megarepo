import { test, expect } from '@playwright/test';

// Small amount of salt added to a large pool of water should dissolve (no solid salt remains)
test('salt dissolves into a large water pool', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  page.on('console', m => console.log('PAGE LOG:', m.text()));
  await page.waitForSelector('text=Alchemist Powder');

  const loadByName = async (name: string) => {
    const nameMatcher = new RegExp(`^${name}$`);
    const row = page.locator('#materials-list > div').filter({ has: page.locator('strong', { hasText: nameMatcher }) }).first();
    await row.click();
    await page.waitForFunction((n) => document.getElementById('status')?.textContent?.includes(n), name, { timeout: 2000 });
  };

  await loadByName('Salt');
  await loadByName('Water');
  await loadByName('SaltWater');

  // Paint a larger pool of water
  await page.evaluate(() => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    const points = [] as {x:number,y:number}[];
    for (let dx = -10; dx <= 10; dx++) {
      for (let dy = -6; dy <= 6; dy++) {
        points.push({x:80+dx, y:80+dy});
      }
    }
    worker.postMessage({type:'paint_points', materialId: map['Water'], points});
    // Paint a small amount of salt in the middle
    worker.postMessage({type:'paint_points', materialId: map['Salt'], points: [{x:80,y:80},{x:81,y:80},{x:80,y:81}]});
  });

  // Wait until paints are applied
  await page.waitForFunction(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return false;
    const waterId = map['Water'];
    const saltId = map['Salt'];
    if (!waterId || !saltId) return false;
    // Check there are at least some water and salt cells present
    let wc = 0, sc = 0;
    for (let i = 0; i < lg.length; i++) {
      if (lg[i] === waterId) wc++;
      if (lg[i] === saltId) sc++;
    }
    return wc > 100 && sc >= 1;
  }, { timeout: 2000 });

  // Step many times and wait for salt count to drop to 0 (i.e., dissolve)
  await page.evaluate(() => {
    const worker = (window as any).__powderWorker;
    // run a bunch of steps asynchronously
    for (let i=0;i<1200;i++) worker.postMessage({type:'step'});
  });

  // Wait until salt count is zero
  const zeroed = await page.waitForFunction(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return false;
    const saltId = map['Salt'];
    if (!saltId) return false;
    for (let i=0;i<lg.length;i++) if (lg[i] === saltId) return false;
    return true;
  }, { timeout: 10000 });

  expect(zeroed).toBeTruthy();
});