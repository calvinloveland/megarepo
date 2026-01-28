import { test, expect } from '@playwright/test';

test('worker file is requested when initializing worker', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url()));

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Alchemist Powder');

  // ensure init helper present
  await page.waitForFunction(() => !!(window as any).__initWorkerWithMaterial);
  await page.evaluate(() => (window as any).__initWorkerWithMaterial({type:'material', name:'Test', primitives:[]}));

  // wait briefly for requests to fire
  await page.waitForTimeout(500);

  const workerRequested = requests.some(u => u.includes('/sim/worker.ts'));
  console.log('requests captured:', requests.filter(u=>u.includes('/sim/worker.ts')));
  expect(workerRequested).toBeTruthy();
});