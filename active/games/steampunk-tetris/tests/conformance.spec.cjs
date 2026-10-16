// The Arena runs the official Protocol v2 suite on upload; so do we.
// The harness page vendors `vendor/conformance/conformance.js` unmodified.
const { test, expect } = require('@playwright/test');

test.describe('protocol v2 conformance', () => {
  test('passes every official check', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/tests/harness/conformance.html');
    const summary = await page.evaluate(async () => {
      return window.harness.run('/index.html');
    });

    const failures = summary.results.filter((r) => !r.pass).map((r) => `${r.name}: ${r.note}`);
    expect(failures, `failing checks:\n${summary.report}`).toEqual([]);
    expect(summary.pass, summary.report).toBe(true);
    expect(summary.passed).toBe(summary.total);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
