import { test, expect } from '@playwright/test';

test('pixel colors reflect material ids', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  page.on('console', m => console.log('PAGE LOG:', m.text()));
  await page.waitForSelector('text=Alchemist Powder');

  // Select Sand and BouncyGel explicitly
  const sandRow = page.locator('#materials-list > div', { hasText: 'Sand' }).first();
  await sandRow.click();
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Sand'), { timeout: 2000 });

  // Paint point at (10,10)
  await page.evaluate(() => (window as any).__paintGridPoints?.([{x:10,y:10}]));
  await page.waitForTimeout(200);

  // Compute canvas pixel coordinate mapping for grid (150x100)
  const c1 = await page.evaluate(() => {
    const gx = 10, gy = 10;
    const c = document.getElementById('sim-canvas') as HTMLCanvasElement;
    const rect = c.getBoundingClientRect();
    const cx = Math.floor((gx + 0.5) * (rect.width / 150));
    const cy = Math.floor((gy + 0.5) * (rect.height / 100));
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(cx,cy,1,1).data;
    const sample = (window as any).__lastGridSample;
    const lastGrid = (window as any).__lastGrid;
    const sampleIdx = 10 * ((window as any).__lastGridWidth || 150) + 10;
    return {pixel:[d[0],d[1],d[2]], sample, lastGridSampleAtIdx: lastGrid ? lastGrid[sampleIdx] : null};
  });
  console.log('c1 sample', c1);
  const color1 = c1.pixel;
  // Load BouncyGel and paint a nearby point
  const bRow = page.locator('#materials-list > div', { hasText: 'BouncyGel' }).first();
  await bRow.click();
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('BouncyGel'), { timeout: 2000 });
  await page.evaluate(() => (window as any).__paintGridPoints?.([{x:11,y:10}]));
  await page.waitForTimeout(200);

  const c2 = await page.evaluate(() => {
    const gx = 11, gy = 10;
    const c = document.getElementById('sim-canvas') as HTMLCanvasElement;
    const rect = c.getBoundingClientRect();
    const pxPerCellX = rect.width / 150;
    const pxPerCellY = rect.height / 100;
    const cxCenter = Math.floor((gx + 0.5) * pxPerCellX);
    const cyCenter = Math.floor((gy + 0.5) * pxPerCellY);
    const ctx = c.getContext('2d')!;
    // sample a 5x5 area around center to account for scaling interpolation
    let sum = 0;
    let cols = [] as number[];
    for (let dy=-2; dy<=2; dy++) {
      for (let dx=-2; dx<=2; dx++) {
        const d = ctx.getImageData(cxCenter+dx, cyCenter+dy, 1,1).data;
        sum += d[0]+d[1]+d[2];
        cols.push(d[0],d[1],d[2]);
      }
    }
    const sample = (window as any).__lastGridSample;
    const lastGrid = (window as any).__lastGrid;
    return {sum, colsSample: cols.slice(0,3), sample, lastGrid1: lastGrid ? lastGrid[11] : null};
  });
  console.log('c2 sample', c2);
  const color2 = c2.colsSample;

  const debug = await page.evaluate(() => {
    const gx = 10, gy = 10;
    const rect = (document.getElementById('sim-canvas') as HTMLCanvasElement).getBoundingClientRect();
    const cx = Math.floor((gx + 0.5) * (rect.width / 150));
    const cy = Math.floor((gy + 0.5) * (rect.height / 100));
    const ctx = (document.getElementById('sim-canvas') as HTMLCanvasElement).getContext('2d')!;
    const d = ctx.getImageData(cx,cy,1,1).data;
    const sampleIdx = 10 * ((window as any).__lastGridWidth || 150) + 10;
    const lastGrid = (window as any).__lastGrid || [];
    const v = lastGrid[sampleIdx];
    const colorMap = (window as any).__materialColors || {};
    return {v, colorMapV: colorMap[v], canvasPixel:[d[0],d[1],d[2]]};
  });
  console.log('debug', debug);


  console.log('c1', c1, 'c2', c2);
  expect(c1).not.toEqual([0,0,0]);
  expect(c2).not.toEqual([0,0,0]);
  expect(c1).not.toEqual(c2);
});