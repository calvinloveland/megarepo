import { test, expect } from '@playwright/test';

// Salt + Water => SaltWater
// (ensure SaltWater is loaded so the worker can resolve the result id)
test('salt reacts with water to form saltwater', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  page.on('console', m => console.log('PAGE LOG:', m.text()));
  await page.waitForSelector('text=Powder Playground');

  const loadByName = async (name: string) => {
    const nameMatcher = new RegExp(`^${name}$`);
    const row = page.locator('#materials-list > div').filter({ has: page.locator('strong', { hasText: nameMatcher }) }).first();
    await row.locator('button.load').click();
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
