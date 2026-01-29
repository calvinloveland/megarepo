import { test, expect } from '@playwright/test';
import { createFailureLogger } from './helpers/failure_logger';

// Verifies that changing brush size paints a larger area on the canvas
test('brush size affects painted area', async ({ page }, testInfo) => {
  const logger = createFailureLogger(testInfo, page);
  let failed = false;
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('text=Alchemist Powder');

    // Programmatically initialize worker with a simple material AST
    const sandAst = {
      type: 'material', name: 'Sand', description: 'Test sand', primitives: []
    };
    // wait for the init helper to be available
    await page.waitForFunction(() => !!(window as any).__initWorkerWithMaterial, { timeout: 5000 });
    await page.evaluate((ast) => { (window as any).__initWorkerWithMaterial(ast); }, sandAst);

    // wait for canvas tools to attach (brush-size control)
    await page.waitForSelector('#brush-size', { timeout: 5000 });

    // ensure worker exists; if not, try clicking 'Load' on the 'Sand' material to initialize
    try {
      await page.waitForFunction(() => !!(window as any).__powderWorker, { timeout: 2000 });
    } catch (e) {
      const sandRow = page.locator('#materials-list > div', { hasText: 'Sand' }).first();
      await sandRow.click();
      await page.waitForFunction(() => !!(window as any).__powderWorker, { timeout: 5000 });
    }

    const canvas = await page.$('canvas#sim-canvas');
    const box = (await canvas!.boundingBox())!;
    // pick a point near center
    const cx = Math.floor(box.x + box.width/2);
    const cy = Math.floor(box.y + box.height/4);

    // helper to sample a small area and count non-black pixels
    const countPainted = async () => {
      return await page.evaluate(({px,py}) => {
        const c = document.getElementById('sim-canvas') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        let count = 0;
        // sample 11x11 area centered at px,py
        for (let dy=-5; dy<=5; dy++) for (let dx=-5; dx<=5; dx++) {
          const d = ctx.getImageData(px+dx, py+dy, 1, 1).data;
          const brightness = d[0]+d[1]+d[2];
          if (brightness > 0) count++;
        }
        return count;
      }, {px: Math.floor(box.width/2), py: Math.floor(box.height/4)});
    };

    // ensure small brush paints fewer pixels than large brush
    // wait for brush-size control to be available (attached after worker ready)
    await page.waitForSelector('#brush-size', { timeout: 5000 });
    // set small brush
    await page.selectOption('#brush-size', '1');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200); // wait for auto-step
    const smallCount = await countPainted();

    // clear grid
    await page.click('button#clear-grid');
    await page.waitForTimeout(100);

    // set large brush
    await page.selectOption('#brush-size', '5');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    const largeCount = await countPainted();

    logger.log('smallCount', smallCount, 'largeCount', largeCount);
    expect(largeCount).toBeGreaterThan(smallCount);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});
