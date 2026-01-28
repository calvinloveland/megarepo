import { test, expect } from '@playwright/test';

test('discovered mix appears in UI list', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__mixApiBase = 'http://127.0.0.1:1';
    const suffix = Date.now().toString();
    const aName = `MixSeedA_${suffix}`;
    const bName = `MixSeedB_${suffix}`;
    const mixName = `Alloy_${suffix}`;
    (window as any).__mixTestNames = { aName, bName, mixName };
    const key = [aName, bName].sort().join('|');
    const cache: Record<string, any> = {};
    cache[key] = {
      type: 'material',
      name: mixName,
      description: 'Cached mix material',
      primitives: [{ op: 'read', dx: 0, dy: 1 }],
      budgets: { max_ops: 6, max_spawns: 0 }
    };
    localStorage.setItem('alchemistPowder.mixCache.version', 'v2');
    localStorage.setItem('alchemistPowder.mixCache.v2', JSON.stringify(cache));
  });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');

  const names = await page.evaluate(() => (window as any).__mixTestNames);
  await page.evaluate(({ aName, bName }) => {
    const a = { type: 'material', name: aName, description: 'A', primitives: [], budgets: { max_ops: 1, max_spawns: 0 } };
    const b = { type: 'material', name: bName, description: 'B', primitives: [], budgets: { max_ops: 1, max_spawns: 0 } };
    (window as any).__initWorkerWithMaterial?.(a);
    (window as any).__initWorkerWithMaterial?.(b);
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({ type: 'paint_points', materialId: map[aName], points: [{ x: 70, y: 70 }] });
    worker.postMessage({ type: 'paint_points', materialId: map[bName], points: [{ x: 71, y: 70 }] });
    worker.postMessage({ type: 'step' });
  }, names);

  await expect(page.locator('#discovered-section')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#discovered-list')).toContainText(names.mixName);
});
