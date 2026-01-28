import { test, expect } from '@playwright/test';

test('mix banner shows while generating new material', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');

  // Register two unique materials so the mix is guaranteed to be uncached
  const { nameA, nameB } = await page.evaluate(() => {
    const suffix = Date.now().toString();
    const a = { type: 'material', name: `MixTestA_${suffix}`, description: 'A', primitives: [], budgets: { max_ops: 1, max_spawns: 0 } };
    const b = { type: 'material', name: `MixTestB_${suffix}`, description: 'B', primitives: [], budgets: { max_ops: 1, max_spawns: 0 } };
    (window as any).__initWorkerWithMaterial?.(a);
    (window as any).__initWorkerWithMaterial?.(b);
    return { nameA: a.name, nameB: b.name };
  });

  // Paint adjacent points so they touch and trigger a mix
  await page.evaluate(({ nameA, nameB }) => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({type:'paint_points', materialId: map[nameA], points: [{x:70,y:70}]});
    worker.postMessage({type:'paint_points', materialId: map[nameB], points: [{x:71,y:70}]});
    worker.postMessage({type:'step'});
  }, { nameA, nameB });

  // Banner should appear with mix message
  const banner = page.locator('#mix-banner');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText('Mixing');
});
