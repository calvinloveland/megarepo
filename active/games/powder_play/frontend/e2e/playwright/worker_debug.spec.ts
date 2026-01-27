import { test } from '@playwright/test';

test('worker debug logs', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => logs.push(`CONSOLE: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`PAGE ERROR: ${err.message}`));
  page.on('requestfailed', req => logs.push(`REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForSelector('text=Powder Playground');
  await page.waitForFunction(() => !!(window as any).__initWorkerWithMaterial);

  await page.evaluate(() => (window as any).__initWorkerWithMaterial({type:'material', name:'Dbg', primitives:[]}));

  // wait a bit
  await page.waitForTimeout(1000);
  console.log('Captured logs:');
  for (const l of logs) console.log(l);
});