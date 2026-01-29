import { test, expect } from '@playwright/test';

test('mix banner shows while generating new material', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');
  await page.waitForFunction(() => (window as any).__mixCacheReady === true, null, { timeout: 10000 });

  // Register two unique materials so the mix is guaranteed to be uncached
  const { nameA, nameB } = await page.evaluate(() => {
    const suffix = Date.now().toString();
    const a = { type: 'material', name: `MixTestA_${suffix}`, description: 'A', tags: ['sand'], density: 1.3, color: [200, 180, 120] };
    const b = { type: 'material', name: `MixTestB_${suffix}`, description: 'B', tags: ['flow'], density: 1.0, color: [80, 120, 200] };
    (window as any).__initWorkerWithMaterial?.(a);
    (window as any).__initWorkerWithMaterial?.(b);
    return { nameA: a.name, nameB: b.name };
  });

  // Trigger mix generation explicitly
  await page.evaluate(({ nameA, nameB }) => {
    (window as any).__triggerMixForNames?.(nameA, nameB);
  }, { nameA, nameB });

  // Banner should appear with mix message
  const banner = page.locator('#mix-banner');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText('New material discovered');
});
