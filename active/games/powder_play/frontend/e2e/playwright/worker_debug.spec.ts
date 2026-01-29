import { test } from '@playwright/test';
import { createFailureLogger } from './helpers/failure_logger';

test('worker debug logs', async ({ page }, testInfo) => {
  const logger = createFailureLogger(testInfo, page);
  let failed = false;
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('text=Alchemist Powder');
    await page.waitForFunction(() => !!(window as any).__initWorkerWithMaterial);

    await page.evaluate(() => (window as any).__initWorkerWithMaterial({type:'material', name:'Dbg', primitives:[]}));

    // wait a bit
    await page.waitForTimeout(1000);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});