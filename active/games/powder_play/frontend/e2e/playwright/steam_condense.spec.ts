import { test, expect } from '@playwright/test';

test('steam condenses to water at top', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  page.on('console', m => console.log('PAGE LOG:', m.text()));
  await page.waitForSelector('text=Powder Playground');

  const loadByName = async (name: string) => {
    const nameMatcher = new RegExp(`^${name}$`);
    const row = page.locator('#materials-list > div').filter({ has: page.locator('strong', { hasText: nameMatcher }) }).first();
    await row.locator('button.load').click();
    await page.waitForFunction((n) => document.getElementById('status')?.textContent?.includes(n), name, { timeout: 2000 });
  };

  await loadByName('Water');
  await loadByName('Steam');

  // paint steam at the top row
  await page.evaluate(() => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({type:'paint_points', materialId: map['Steam'], points: [{x:20,y:0}]});
  });

  // step to trigger condense at top
  await page.evaluate(() => (window as any).__powderWorker?.postMessage({type:'step'}));

  await page.waitForFunction(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const map = (window as any).__materialIdByName || {};
    if (!lg) return false;
    return lg[0 * w + 20] === map['Water'];
  }, { timeout: 2000 });

  const id = await page.evaluate(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    if (!lg) return null;
    return lg[0 * w + 20];
  });

  expect(id).not.toBeNull();
});
