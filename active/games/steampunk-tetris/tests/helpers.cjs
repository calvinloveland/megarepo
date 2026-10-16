// Shared helpers for the Brass & Boiler Playwright suite.
const { expect } = require('@playwright/test');

/** Wait until the page has built its engine and published the test surface. */
async function waitForGame(page) {
  await page.waitForFunction(() => !!(window.__tetris && window.__tetris.engine && window.__tetris.api), { timeout: 10_000 });
}

/** Protocol state, straight from the engine. */
async function state(page) {
  return page.evaluate(() => window.__tetris.api.state());
}

/** Advance the engine deterministically (no rAF, no sleeping). */
async function advance(page, ms, step = 8) {
  return page.evaluate(([m, s]) => window.__tetris.api.advance(m, s), [ms, step]);
}

function attachErrorCollector(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  return {
    pageErrors,
    consoleErrors,
    assertClean() {
      expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
      expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    },
  };
}

module.exports = { waitForGame, state, advance, attachErrorCollector };
