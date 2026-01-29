import { test, expect } from '@playwright/test';

test('mix uses cached material after reload', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__mixApiBase = 'http://127.0.0.1:1';
    const key = ['Sand', 'Water'].sort().join('|');
    const cache: Record<string, any> = {};
    cache[key] = {
      type: 'material',
      name: 'SiltMist',
      description: 'Cached sand+water mix',
      tags: ['sand'],
      density: 1.4,
      color: [180, 170, 140]
    };
    localStorage.setItem('alchemistPowder.mixCache.version', 'v2');
    localStorage.setItem('alchemistPowder.mixCache.v2', JSON.stringify(cache));

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as any)?.url || '';
      if (url.includes('/llm')) {
        throw new Error('LLM should not be called when cache is present');
      }
      return originalFetch(input, init);
    };
  });

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');
  await page.click('#materials-list >> text=Sand');
  await page.click('#materials-list >> text=Water');

  await page.waitForFunction(() => {
    const map = (window as any).__materialIdByName || {};
    return !!(window as any).__powderWorker && !!map.Sand && !!map.Water;
  });

  await page.evaluate(() => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({ type: 'paint_points', materialId: map.Sand, points: [{ x: 70, y: 70 }] });
    worker.postMessage({ type: 'paint_points', materialId: map.Water, points: [{ x: 71, y: 70 }] });
    worker.postMessage({ type: 'step' });
  });

  await expect(page.locator('#discovered-list')).toContainText('SiltMist');

  await page.reload();
  await page.waitForSelector('text=Alchemist Powder');
  await page.click('#materials-list >> text=Sand');
  await page.click('#materials-list >> text=Water');

  await page.waitForFunction(() => {
    const map = (window as any).__materialIdByName || {};
    return !!(window as any).__powderWorker && !!map.Sand && !!map.Water;
  });

  await page.evaluate(() => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    worker.postMessage({ type: 'paint_points', materialId: map.Sand, points: [{ x: 72, y: 70 }] });
    worker.postMessage({ type: 'paint_points', materialId: map.Water, points: [{ x: 73, y: 70 }] });
    worker.postMessage({ type: 'step' });
  });

  await expect(page.locator('#discovered-list')).toContainText('SiltMist');
});
