import { test, expect } from '@playwright/test';

// Salt + Water => SaltWater
// (ensure SaltWater is loaded so the worker can resolve the result id)
test('salt reacts with water to form saltwater', async ({ page }) => {
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

  // Paint salt at (70,70), water at (71,70) without stepping in between
  await page.evaluate(() => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({type:'paint_points', materialId: map['Salt'], points: [{x:70,y:70}]});
    worker.postMessage({type:'paint_points', materialId: map['Water'], points: [{x:71,y:70}]});
  });

  // Wait until both cells are painted before stepping
  await page.waitForFunction(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return false;
    const a = lg[70 * w + 70];
    const b = lg[70 * w + 71];
    return a === map['Salt'] && b === map['Water'];
  }, { timeout: 2000 });

  // Step to allow reaction
  await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));
  await page.waitForFunction(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return false;
    const a = lg[70 * w + 70];
    const b = lg[70 * w + 71];
    return a === map['SaltWater'] && b === map['SaltWater'];
  }, { timeout: 2000 });

  const ids = await page.evaluate(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return null;
    const idxA = 70 * w + 70;
    const idxB = 70 * w + 71;
    return {a: lg[idxA], b: lg[idxB], saltwaterId: map['SaltWater']};
  });

  expect(ids).not.toBeNull();
  expect(ids!.a).toBe(ids!.saltwaterId);
  expect(ids!.b).toBe(ids!.saltwaterId);
});

// SaltWater + Fire => Steam + Salt
test('saltwater reacts with fire to form steam and salt', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  page.on('console', m => console.log('PAGE LOG:', m.text()));
  await page.waitForSelector('text=Alchemist Powder');

  const loadByName = async (name: string) => {
    const nameMatcher = new RegExp(`^${name}$`);
    const row = page.locator('#materials-list > div').filter({ has: page.locator('strong', { hasText: nameMatcher }) }).first();
    await row.click();
    await page.waitForFunction((n) => document.getElementById('status')?.textContent?.includes(n), name, { timeout: 2000 });
  };

  await loadByName('SaltWater');
  await loadByName('Fire');
  await loadByName('Steam');
  await loadByName('Salt');

  // Paint saltwater at (70,72), fire at (71,72) without stepping in between
  await page.evaluate(() => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({type:'paint_points', materialId: map['SaltWater'], points: [{x:70,y:72}]});
    worker.postMessage({type:'paint_points', materialId: map['Fire'], points: [{x:71,y:72}]});
  });

  // Wait until both cells are painted before stepping
  await page.waitForFunction(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return false;
    const a = lg[72 * w + 70];
    const b = lg[72 * w + 71];
    return a === map['SaltWater'] && b === map['Fire'];
  }, { timeout: 2000 });

  // Step to allow reaction
  await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));
  await page.waitForFunction(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return false;
    const a = lg[72 * w + 70];
    const b = lg[72 * w + 71];
    return a === map['Steam'] && b === map['Salt'];
  }, { timeout: 2000 });

  const ids = await page.evaluate(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return null;
    const idxA = 72 * w + 70;
    const idxB = 72 * w + 71;
    return {a: lg[idxA], b: lg[idxB], steamId: map['Steam'], saltId: map['Salt']};
  });

  expect(ids).not.toBeNull();
  expect(ids!.a).toBe(ids!.steamId);
  expect(ids!.b).toBe(ids!.saltId);
});
