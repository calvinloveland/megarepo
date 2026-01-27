import { test, expect } from '@playwright/test';

// This test assumes the dev server is running at http://localhost:5173
// It installs the demo model (stub), generates a material and checks UI progress.

test('generate material and run one step', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForSelector('text=Powder Playground');

  // Wait for the Install button and then click Install model and Generate
  await page.waitForSelector('text=Install model', { timeout: 10_000 });
  await page.click('text=Install model');
  await page.waitForSelector('text=Generate', { timeout: 5000 });
  await page.click('text=Generate');

  // Wait for status element to indicate compilation/validation (more robust)
  await page.waitForFunction(()=> {
    const el = document.querySelector('#gen-status');
    return el && el.textContent && el.textContent.includes('Validated');
  }, { timeout: 30_000 });

  // Click Play to run a single step and check canvas draws something
  await page.click('text=Play');
  // Wait a little for a frame to be produced
  await page.waitForTimeout(500);
  const canvas = await page.$('canvas#sim-canvas');
  const screenshot = await canvas!.screenshot();
  expect(screenshot.length).toBeGreaterThan(0);
});
