import { test, expect } from '@playwright/test';

// Paint water, run simulation, and ensure number of water cells stays the same.
test('water count is conserved after long steps', async ({ page }) => {
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

  console.log('water count before/after', beforeCount, afterCount);
  expect(afterCount).toBe(beforeCount);
});
