import { test, expect } from '@playwright/test';

// Demo scene: paint a small pile at the top and assert it falls down after steps
test('demo scene: paint sand and it falls down', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForSelector('text=Powder Playground');

  // Use the install & generate flow to load a material (demo model)
  await page.click('text=Install model');
  await page.click('text=Generate');
  await page.waitForFunction(() => {
    const el = document.querySelector('#gen-status');
    return el && el.textContent && el.textContent.includes('Validated');
  }, { timeout: 30_000 });

  // Load demo scene file from repo and paint points programmatically
  const sceneResp = await page.request.get(new URL('/demo/simple_scene.json', page.url()).toString());
  const scene = await sceneResp.json();
  // Map grid coords -> canvas pixel coords (canvas is 600x400 and grid is 150x100)
  const canvas = await page.$('canvas#sim-canvas');
  const box = await canvas!.boundingBox();
  if (!box) throw new Error('canvas not found');

  // helper to click at grid point
  const clickAtGrid = async (gx:number, gy:number) => {
    const cx = box.x + (gx + 0.5) * (box.width / 150);
    const cy = box.y + (gy + 0.5) * (box.height / 100);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
  }

  // Wait for canvas tools to be attached (happens after worker ready)
  await page.waitForSelector('#clear-grid', { timeout: 5000 });

  // Use the helper exposed by the app to set the grid directly (avoid flaky mouse events)
  await page.evaluate((points) => {
    (window as any).__paintGridPoints(points);
  }, scene.paintPoints);

  // Wait briefly for grid to transfer
  await page.waitForTimeout(300);

  // Sample pixel color at top point and one below before stepping
  const getPixel = async (px:number, py:number) => {
    return await page.evaluate(({px,py}) => {
      const c = document.getElementById('sim-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }, {px,py});
  };

  // sample positions in canvas pixels for grid coords we painted (75,5) and a lower row (75,20)
  const toCanvas = (gx:number, gy:number) => {
    const cx = Math.floor((gx + 0.5) * (box.width / 150));
    const cy = Math.floor((gy + 0.5) * (box.height / 100));
    return {cx, cy};
  }
  const topSample = toCanvas(75, 5);
  const lowSample = toCanvas(75, 20);

  const beforeTop = await getPixel(topSample.cx, topSample.cy);
  const beforeLow = await getPixel(lowSample.cx, lowSample.cy);

  // Step simulation many times to let gravity act
  for (let i=0;i<30;i++) {
    await page.click('text=Step');
    await page.waitForTimeout(100);
  }

  const afterTop = await getPixel(topSample.cx, topSample.cy);
  const afterLow = await getPixel(lowSample.cx, lowSample.cy);

  // Expect that a bright (white-ish) pixel moved downward: the low pixel should be brighter after stepping
  const brightness = (c:any) => (c[0]+c[1]+c[2])/3;
  expect(brightness(afterLow)).toBeGreaterThanOrEqual(brightness(beforeLow));
  expect(brightness(afterLow)).toBeGreaterThan(brightness(afterTop));
});