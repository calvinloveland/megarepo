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
  const scene = await (await fetch('/demo/simple_scene.json')).json();
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

  for (const p of scene.paintPoints) {
    await clickAtGrid(p.x, p.y);
  }

  // Wait briefly for grid to transfer
  await page.waitForTimeout(100);

  // Sample pixel color at top point and one below before stepping
  const getPixel = async (px:number, py:number) => {
    return await page.evaluate(({px,py}) => {
      const c = document.getElementById('sim-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }, {px,py});
  };

  // sample positions in canvas pixels (center)
  const sampleX = Math.floor(box.x + box.width/2);
  const sampleTopY = Math.floor(box.y + (6 / 100) * box.height);
  const sampleLowY = Math.floor(box.y + (20 / 100) * box.height);

  const beforeTop = await getPixel(sampleX - Math.floor(box.x), sampleTopY - Math.floor(box.y));
  const beforeLow = await getPixel(sampleX - Math.floor(box.x), sampleLowY - Math.floor(box.y));

  // Step simulation several times
  for (let i=0;i<6;i++) {
    await page.click('text=Step');
    await page.waitForTimeout(50);
  }

  const afterTop = await getPixel(sampleX - Math.floor(box.x), sampleTopY - Math.floor(box.y));
  const afterLow = await getPixel(sampleX - Math.floor(box.x), sampleLowY - Math.floor(box.y));

  // Expect that a bright (white-ish) pixel moved downward: the low pixel should be brighter after stepping
  const brightness = (c:any) => (c[0]+c[1]+c[2])/3;
  expect(brightness(afterLow)).toBeGreaterThanOrEqual(brightness(beforeLow));
  expect(brightness(afterLow)).toBeGreaterThan(brightness(afterTop));
});