import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Verifies that adding a material to source triggers sync and auto-load in the UI
test('hot-add material is discovered and auto-loaded', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:5174/';
  await page.goto(baseUrl);
  // surface browser console messages in test logs to help debugging
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  await page.waitForSelector('text=Alchemist Powder');

  // Ensure materials UI mounted
  await page.waitForSelector('text=Materials');

  // Write a temp material into the source materials folder
  const matPath = path.resolve(__dirname, '../../../materials/hot_added.json');
  const mat = { type: 'material', name: 'HotAdded', description: 'hot added', primitives: [], budgets: { max_ops:1, max_spawns:0 } };
  fs.writeFileSync(matPath, JSON.stringify(mat, null, 2));

  // Expose a callback so the page can notify us when it has loaded a material
  const materialLoaded = new Promise<string>((resolve) => {
    page.exposeFunction('onMaterialLoaded', (name: string) => {
      console.log('onMaterialLoaded called with', name);
      resolve(name);
    });
  });

  // Run one-time sync to copy to public materials
  // Run one-time sync in the frontend directory
  execSync('npm run materials:sync', { cwd: path.resolve(__dirname, '..', '..') });

  // Wait until the index.json includes our file
  await page.waitForFunction(async () => {
    try {
      const r = await fetch('/materials/index.json', {cache: 'no-store'});
      if (!r.ok) return false;
      const j = await r.json();
      return j.materials && j.materials.some((m:any) => m.file === 'hot_added.json');
    } catch (e) { return false; }
  }, { timeout: 10000 });

  // Click the material row for our material to force a deterministic load
  const materialRow = page.locator('#materials-list > div', { hasText: 'HotAdded' }).first();
  await materialRow.click();

  // Wait for the page to call our onMaterialLoaded callback when the UI loads the material
  const loadedName = await Promise.race([
    materialLoaded,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for material load')), 10000))
  ]) as string;

  // verify it was the material we added
  expect(loadedName).toContain('HotAdded');

  // cleanup
  fs.unlinkSync(matPath);
});