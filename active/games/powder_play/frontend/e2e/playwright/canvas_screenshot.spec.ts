import { test } from '@playwright/test';
import * as fs from 'fs';

// Take a screenshot of the canvas after loading Sand and painting a few points
test('canvas screenshot after loading material', async ({ page }) => {
  const outDir = 'test-artifacts';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = `${outDir}/canvas_after_material.png`;

  await page.goto('http://127.0.0.1:5173/');
  page.on('console', m => console.log('PAGE LOG:', m.text()));
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
  console.log('Saved canvas screenshot to', outPath);
});