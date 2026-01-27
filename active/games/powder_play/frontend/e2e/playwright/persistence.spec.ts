import { test, expect } from '@playwright/test';

// Paint, let sim run, paint again, ensure new paint wasn't overwritten by an old snapshot
test('paint persists after simulation runs and additional painting', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  page.on('console', m => console.log('PAGE LOG:', m.text()));
  await page.waitForSelector('text=Powder Playground');

  // Load Sand
  const sandRow = page.locator('#materials-list > div', { hasText: 'Sand' }).first();
  await sandRow.locator('button.load').click();
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Sand'), { timeout: 2000 });

  // paint point A near bottom so it won't drift away
  await page.evaluate(() => (window as any).__paintGridPoints?.([{x:75,y:80}]));
  // wait for grid_set to be processed and UI to render
  await page.waitForFunction(() => (window as any).__lastGridSample !== undefined, { timeout: 2000 });
  // check immediate presence
  const immediate = await page.evaluate(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    const idx = 80 * w + 75;
    return lg ? lg[idx] : null;
  });
  console.log('immediatePaint', immediate);

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

  // inspect last grid for presence of non-zero at both approximate positions
  const gridCheck = await page.evaluate(() => {
    const lg = (window as any).__lastGrid as Uint16Array | undefined;
    const w = (window as any).__lastGridWidth || 150;
    if (!lg) return null;
    const idxA = 80 * w + 75; // y=80,x=75
    const idxB = 80 * w + 80;
    return {a: lg[idxA], b: lg[idxB]};
  });

  console.log('gridCheck', gridCheck);
  expect(gridCheck).not.toBeNull();
  expect(gridCheck.a).toBeGreaterThan(0);
  expect(gridCheck.b).toBeGreaterThan(0);
});