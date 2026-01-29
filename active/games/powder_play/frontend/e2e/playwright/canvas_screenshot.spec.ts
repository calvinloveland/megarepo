import { test } from '@playwright/test';
import { createFailureLogger } from './helpers/failure_logger';
import * as fs from 'fs';

// Take a screenshot of the canvas after loading Sand and painting a few points
test('canvas screenshot after loading material', async ({ page }, testInfo) => {
  const logger = createFailureLogger(testInfo, page);
  let failed = false;
  try {
    const outDir = 'test-artifacts';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const outPath = `${outDir}/canvas_after_material.png`;

    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('text=Alchemist Powder');

    // Select Sand from the materials list
    const sandRow = page.locator('#materials-list > div', { hasText: 'Sand' }).first();
    await sandRow.click();

    // Wait for status text to show Sand loaded
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && el.textContent && el.textContent.includes('Sand');
    }, { timeout: 5000 });

    // Paint a few points programmatically using helper
    await page.evaluate(() => {
      (window as any).__paintGridPoints?.([{x: 74, y: 5}, {x:75,y:5}, {x:76,y:5}, {x:75,y:6}]);
    });

    // wait a short time for worker to process
    await page.waitForTimeout(300);

    const canvas = await page.$('canvas#sim-canvas');
    if (!canvas) throw new Error('canvas not found');
    await canvas.screenshot({ path: outPath });
    logger.log('Saved canvas screenshot to', outPath);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});