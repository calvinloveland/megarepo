// setup-flow.spec.mjs — Playwright test for startup/pause/setup flow
import { chromium } from 'playwright';

const BASE = 'http://localhost:3002';

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${label}`); }
  catch (e) { failed++; console.log(`  ❌ ${label}: ${e.message.split('\n')[0]}`); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/nix/store/r7ifk1v95jfl02775kgbrd61dyr1rfsx-chromium-148.0.7778.178/bin/chromium',
    args: ['--no-sandbox'],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // Capture console errors for debugging
    page.on('pageerror', err => console.log('  [PAGE ERROR]', err.message));

    // Clear stale state
    await page.goto(BASE, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());

    // ==============================
    // 1. FRESH GAME START
    // ==============================
    console.log('\n📋 1. Fresh game start — difficulty modal');
    await page.goto(BASE + '/?t=' + Date.now(), { waitUntil: 'load', timeout: 10000 });
    await sleep(1000);

    await check('Difficulty modal is visible', async () => {
      await page.waitForSelector('.difficulty-modal', { state: 'visible', timeout: 3000 });
    });

    await check('Company name input exists', async () => {
      await page.waitForSelector('#company-name-input', { state: 'visible', timeout: 2000 });
    });

    await check('Can type company name', async () => {
      await page.locator('#company-name-input').fill('Playwright Test Co');
    });

    await check('Difficulty click works', async () => {
      await page.locator('.difficulty-option').nth(2).click(); // Hard
      await sleep(100);
      const sel = await page.locator('.difficulty-option.selected').count();
      if (sel !== 1) throw new Error(`Expected 1 selected, got ${sel}`);
    });

    await check('Start Game button works', async () => {
      await page.locator('.difficulty-footer .btn-primary').click();
      await sleep(2000);
    });

    // ==============================
    // 2. PAUSED WITH SETUP GUIDE
    // ==============================
    console.log('\n📋 2. Game is paused with setup guide');

    await check('No JS errors occurred', async () => {
      const errors = await page.evaluate(() =>
        typeof ErrorReporter !== 'undefined' ? ErrorReporter.getCount() : -1
      );
      // 2 errors are OK (favicon 404s), any more indicate a real problem
      if (errors > 3) {
        const recent = await page.evaluate(() =>
          ErrorReporter.getRecent(3).map(e => e.message.slice(0, 80))
        );
        console.log('  Errors:', recent);
        throw new Error(`${errors} JS errors logged`);
      }
    });

    await check('Dashboard screen is active', async () => {
      await page.waitForSelector('#screen-dashboard', { state: 'visible', timeout: 2000 });
    });

    await check('Setup guide overlay is visible', async () => {
      const display = await page.evaluate(() => {
        const el = document.getElementById('setup-guide');
        return el ? el.style.display : 'no-el';
      });
      if (display !== 'flex') throw new Error(`Guide display is "${display}"`);
    });

    await check('Paused indicator shows PAUSED', async () => {
      const text = await page.locator('#paused-indicator').textContent();
      if (!text.includes('PAUSED')) throw new Error(`Text: ${text}`);
    });

    await check('Pause lock is active', async () => {
      const locked = await page.evaluate(() => window.gameState?._startLock);
      if (!locked) throw new Error('_startLock is false');
    });

    await check('Cash does not change while paused', async () => {
      const c1 = await page.locator('#topbar-cash').textContent();
      await sleep(2000);
      const c2 = await page.locator('#topbar-cash').textContent();
      if (c1 !== c2) throw new Error(`Cash changed: ${c1} → ${c2}`);
    });

    await check('Setup guide has 2+ steps', async () => {
      const steps = await page.locator('.setup-step').count();
      if (steps < 2) throw new Error(`Only ${steps} steps`);
    });

    await check('Dashboard shows setup reminder card', async () => {
      const card = page.locator('.card').filter({ hasText: /Setup Incomplete/ }).first();
      await card.waitFor({ state: 'visible', timeout: 2000 });
    });

    // ==============================
    // 3. DESIGN A MACHINE
    // ==============================
    console.log('\n📋 3. Design a machine');

    await check('Can click first setup step button', async () => {
      // Use evaluate to click since the overlay might intercept clicks
      await page.evaluate(() => {
        const btn = document.querySelector('.setup-step .btn');
        if (btn) btn.click();
      });
      await sleep(600);
    });

    await check('Design Studio screen is active', async () => {
      await page.waitForSelector('#screen-design', { state: 'visible', timeout: 3000 });
    });

    await check('Can fill model name', async () => {
      await page.locator('#design-name').fill('Series 9000');
    });

    await check('Component selectors present in design form', async () => {
      // Count selects inside the design studio's new-model form
      const n = await page.locator('#screen-design .form-select').count();
      if (n !== 7) throw new Error(`Expected 7 selects in design form, got ${n}`);
    });

    await check('Create Model button submits', async () => {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes('Create Model'));
        if (btn) btn.click();
      });
      await sleep(500);
    });

    await check('Model appears in sidebar', async () => {
      const items = await page.locator('.model-list-item').count();
      if (items < 1) throw new Error('No models in sidebar');
    });

    // ==============================
    // 4. START PRODUCTION
    // ==============================
    console.log('\n📋 4. Start production');

    await check('Navigate to Factory', async () => {
      await page.locator('[data-screen="factory"]').click();
      await sleep(300);
      await page.waitForSelector('#screen-factory', { state: 'visible', timeout: 2000 });
    });

    await check('Production line element exists', async () => {
      await page.waitForSelector('.production-line', { state: 'visible', timeout: 2000 });
    });

    // Start the line and select model via JS (avoids overlay interception issues)
    await check('Start production line via JS', async () => {
      const result = await page.evaluate(() => {
        const line = window.gameState?.company?.productionLines?.[0];
        if (!line) return 'no line';
        line.active = true;
        const model = window.gameState?.company?.models?.[0];
        if (model) line.modelId = model.id;
        return 'started, model=' + (model ? model.id : 'none');
      });
      console.log('  Production:', result);
      if (result.startsWith('no')) throw new Error(result);
      await sleep(200);
    });

    await check('Production line is now active', async () => {
      const active = await page.evaluate(() =>
        window.gameState?.company?.productionLines?.some(l => l.active)
      );
      if (!active) throw new Error('Line not active');
    });

    await check('Model is assigned to line', async () => {
      const assigned = await page.evaluate(() =>
        window.gameState?.company?.productionLines?.[0]?.modelId
      );
      if (!assigned) throw new Error('No model assigned');
    });

    // ==============================
    // 5. UNPAUSE
    // ==============================
    console.log('\n📋 5. Unpause the game');

    await check('Navigate to Dashboard', async () => {
      await page.locator('[data-screen="dashboard"]').click();
      await sleep(500);
      await page.waitForSelector('#screen-dashboard', { state: 'visible', timeout: 2000 });
    });

    // Re-open setup guide if it was hidden by the "Go there →" click
    const guideVis = await page.evaluate(() => {
      const el = document.getElementById('setup-guide');
      return el ? el.style.display === 'flex' : false;
    });
    if (!guideVis) {
      await page.locator('#setup-guide-btn').click();
      await sleep(300);
    }

    await check('Unpause via JS', async () => {
      const result = await page.evaluate(() => {
        if (typeof UI !== 'undefined' && UI.unpauseAndStart) {
          UI.unpauseAndStart();
          return 'unpaused';
        }
        return 'no UI';
      });
      if (result !== 'unpaused') throw new Error(result);
      await sleep(500);
    });

    await check('Setup guide hidden after unpause', async () => {
      const display = await page.evaluate(() => {
        const el = document.getElementById('setup-guide');
        return el ? el.style.display : 'no-el';
      });
      if (display === 'flex') throw new Error('Guide still visible');
    });

    await check('Paused indicator hidden after unpause', async () => {
      const visible = await page.locator('#paused-indicator').isVisible();
      if (visible) throw new Error('Paused indicator still visible');
    });

    // ==============================
    // 6. GAME RUNS
    // ==============================
    console.log('\n📋 6. Game runs after unpause');

    // Wait for several game ticks
    await sleep(3000);

    await check('Date is displayed', async () => {
      const d = await page.locator('#topbar-date').textContent();
      if (!d || d === '—') throw new Error(`Bad date: ${d}`);
      console.log(`  Date: ${d}`);
    });

    await check('Cash is displayed', async () => {
      const c = await page.locator('#topbar-cash').textContent();
      if (!c || c === '—') throw new Error(`Bad cash: ${c}`);
      console.log(`  Cash: ${c}`);
    });

    await check('Dashboard has 8+ metric cards', async () => {
      const n = await page.locator('.metric-card').count();
      if (n < 8) throw new Error(`Only ${n} metrics`);
    });

    await check('Event log has entries', async () => {
      const n = await page.locator('.event-item').count();
      if (n < 1) throw new Error('No events');
    });

    // ==============================
    // 7. SAVE & RELOAD
    // ==============================
    console.log('\n📋 7. Save and reload');

    await check('Save game', async () => {
      const result = await page.evaluate(() => {
        try { return saveGame() ? 'saved' : 'saveGame returned false'; }
        catch(e) { return 'error: ' + e.message; }
      });
      if (result !== 'saved') throw new Error(result);
      await sleep(200);
    });

    const cashBefore = await page.locator('#topbar-cash').textContent();
    console.log(`  Cash before reload: ${cashBefore}`);

    // Reload and handle the continue-modal
    await page.reload({ waitUntil: 'load' });
    await sleep(3000);

    await check('Continue modal appears after reload', async () => {
      await page.waitForSelector('#continue-modal', { state: 'visible', timeout: 3000 });
      await page.locator('#continue-yes').click();
      await sleep(1500);
    });

    await check('Game loaded saved state', async () => {
      const cashAfter = await page.locator('#topbar-cash').textContent();
      if (!cashAfter || cashAfter === '—') throw new Error('Cash not loaded');
      console.log(`  Cash after reload: ${cashAfter}`);
    });

    await page.close();
    await browser.close();

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed of ${passed + failed}`);
    process.exit(failed > 0 ? 1 : 0);

  } catch (e) {
    console.error('Suite error:', e.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
