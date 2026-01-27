import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Verifies that adding a material to source triggers sync and auto-load in the UI
test('hot-add material is discovered and auto-loaded', async ({ page }) => {
  const baseUrl = 'http://127.0.0.1:5174/';
  await page.goto(baseUrl);
  await page.waitForSelector('text=Powder Playground');

  // Ensure materials UI mounted
  await page.waitForSelector('text=Materials');

  // Write a temp material into the source materials folder
  const matPath = path.resolve(__dirname, '../../../materials/hot_added.json');
  const mat = { type: 'material', name: 'HotAdded', description: 'hot added', primitives: [], budgets: { max_ops:1, max_spawns:0 } };
  fs.writeFileSync(matPath, JSON.stringify(mat, null, 2));

  // Run one-time sync to copy to public materials
  execSync('npm run --prefix active/games/powder_play/frontend materials:sync');

  // Wait until the index.json includes our file
  await page.waitForFunction(async () => {
    try {
      const r = await fetch('/materials/index.json', {cache: 'no-store'});
      if (!r.ok) return false;
      const j = await r.json();
      return j.materials && j.materials.some((m:any) => m.file === 'hot_added.json' || m.file === 'hot_added.json');
    } catch (e) { return false; }
  }, { timeout: 10000 });

  // Wait for the UI to auto-load the new material (status element)
  await page.waitForFunction(() => {
    const el = document.getElementById('status');
    return el && el.textContent && el.textContent.includes('HotAdded');
  }, { timeout: 10000 });

  // cleanup
  fs.unlinkSync(matPath);
});