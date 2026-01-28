import { test, expect } from '@playwright/test';

// This test assumes the dev server is running at http://127.0.0.1:5173
// It loads a material and runs a step to ensure the canvas renders.

test('generate material and run one step', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('text=Alchemist Powder');

  // Select Sand from the materials list
  await page.click('#materials-list >> text=Sand');

  // Click Step to run a single step and check canvas draws something
  await page.click('text=Step');
  // Wait a little for a frame to be produced
  await page.waitForTimeout(500);
  const canvas = await page.$('canvas#sim-canvas');
  const screenshot = await canvas!.screenshot();
  expect(screenshot.length).toBeGreaterThan(0);
});
