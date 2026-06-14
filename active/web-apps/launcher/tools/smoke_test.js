// Headless smoke test for the launcher dashboard.
//
// Loads the page in Chromium, exercises every tab, clicks the demo
// modal, and verifies that no uncaught page errors or unexpected
// console errors occur. Catches regressions like the duplicate
// 'const SCENES' SyntaxError that left the page inert for days.
//
// Run from the repo root with:
//   node tools/smoke_test.js                          # default: http://localhost:3001
//   URL=https://launcher.shsw.dev node tools/smoke_test.js
//   CHROMIUM=/path/to/chromium node tools/smoke_test.js
//
// Requires: puppeteer-core + a Chromium build on disk. Install once:
//   npm install --prefix tools puppeteer-core

const puppeteer = require('puppeteer-core');

const TARGET = process.env.URL || 'http://localhost:3001';
const CHROMIUM = process.env.CHROMIUM || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : (() => {
        // Try common Nix store paths
        const { execSync } = require('child_process');
        try {
          return execSync('nix-build --no-out-link -E \'with import <nixpkgs> {}; chromium\' 2>/dev/null', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim() + '/bin/chromium';
        } catch (e) {
          return '/usr/bin/chromium';
        }
      })()
);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    const icon = ok ? '✓' : '✗';
    console.log(`  ${icon} ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // Ignore benign resource 404s that aren't part of the app
        if (!/favicon|\.well-known/.test(t)) consoleErrors.push(t);
      }
    });

    console.log(`\nSmoke-testing ${TARGET}\n`);
    await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));  // let physics settle

    // ── Apps tab (default) ──
    check('Apps tab: 15 container cards rendered',
      (await page.$$eval('.container-card', els => els.length)) === 15);
    check('Apps tab: physics scene initialized (cards have position styles)',
      (await page.$$eval('.container-card',
        els => els.filter(e => e.style.left && e.style.top).length)) === 15);
    check('Apps tab: every card has a DEMO button',
      (await page.$$eval('.container-card .btn-demo', els => els.length)) === 15);
    check('Apps tab: every card has a START/OPEN button',
      (await page.$$eval('.container-card .btn-start, .container-card .btn-open',
        els => els.length)) === 15);

    // ── Demos tab ──
    await page.click('[data-tab="demos"]');
    await page.waitForSelector('.demo-card', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 300));
    check('Demos tab: 15 demo cards rendered',
      (await page.$$eval('.demo-card', els => els.length)) === 15);
    check('Demos tab: each card has a thumbnail image',
      (await page.$$eval('.demo-card img', els => els.length)) === 15);
    check('Demos tab: counter shows 15',
      (await page.$eval('#demosCount', el => el.textContent)) === '15');

    // ── Demo modal ──
    await page.evaluate(() => document.querySelector('.demo-card').click());
    await new Promise(r => setTimeout(r, 400));
    check('Modal opens on demo click',
      await page.$eval('#demoModal', el => el.classList.contains('open')));
    check('Modal has a video source',
      await page.$eval('#demoVideo', el => !!el.src && el.src.includes('.mp4')));
    check('Modal has a poster image',
      await page.$eval('#demoVideo', el => !!el.poster && el.poster.includes('.jpg')));
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 200));
    check('Modal closes on ESC',
      await page.$eval('#demoModal', el => !el.classList.contains('open')));

    // ── Projects tab ──
    await page.click('[data-tab="projects"]');
    await new Promise(r => setTimeout(r, 1500));
    const projectCount = await page.$$eval('.compact-project', els => els.length);
    check(`Projects tab: rendered ${projectCount} project rows`, projectCount > 10);

    const searchInput = await page.$('#project-search');
    if (searchInput) {
      await searchInput.type('mom', { delay: 30 });
      await new Promise(r => setTimeout(r, 300));
      const filtered = await page.$$eval('.compact-project', els => els.length);
      check(`Projects search: 'mom' narrows to ${filtered} row(s)`,
        filtered > 0 && filtered < projectCount);
      await searchInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
    }

    // ── Docs tab ──
    await page.click('[data-tab="docs"]');
    await new Promise(r => setTimeout(r, 500));
    const docCount = await page.$$eval('.doc-list-btn', els => els.length);
    check(`Docs tab: rendered ${docCount} doc buttons`, docCount > 0);

    // ── Back to apps ──
    await page.click('[data-tab="apps"]');
    await new Promise(r => setTimeout(r, 1500));
    check('Apps tab: 15 cards re-rendered after return',
      (await page.$$eval('.container-card', els => els.length)) === 15);

    // ── Final error sweep ──
    check('No uncaught page errors across all tabs',
      pageErrors.length === 0, pageErrors.join('; '));
    check('No unexpected console errors',
      consoleErrors.length === 0, consoleErrors.join('; '));

  } finally {
    await browser.close();
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed === results.length ? '✓' : '✗'} ${passed}/${results.length} checks passed\n`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
