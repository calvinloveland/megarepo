// Bot runs in a real browser: real iframe, real clock, real 30 actions/second.
// The exhaustive, deterministic bot testing lives in tests/node/bots.test.mjs —
// this suite proves the bots work through the actual protocol surface.
const { test, expect } = require('@playwright/test');

const RATE_LIMIT_ACTIONS_PER_SECOND = 30;

test.describe('submitted bots over postMessage', () => {
  test('score maximiser plays a real match', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/tests/harness/bot-runner.html');
    const result = await page.evaluate(() => window.botRunner.run({
      botUrl: '/bots/dist/boiler-stoker.js',
      seed: 'arena',
      timeLimitMs: 25_000,
    }));

    expect(result.error, `bot threw: ${result.error}`).toBeNull();
    expect(result.maxPiece).toBeGreaterThan(120);
    expect(result.maxScore).toBeGreaterThan(3000);
    expect(result.illegal).toBeLessThan(result.actions * 0.2);
    const rate = result.actions / (result.ms / 1000);
    expect(rate).toBeLessThanOrEqual(RATE_LIMIT_ACTIONS_PER_SECOND + 1);
  });

  test('Tetris hunter plays a real match and only clears four rows', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/tests/harness/bot-runner.html');
    const result = await page.evaluate(() => window.botRunner.run({
      botUrl: '/bots/dist/four-line-fanatic.js',
      seed: 'arena',
      timeLimitMs: 25_000,
    }));

    expect(result.error, `bot threw: ${result.error}`).toBeNull();
    expect(result.maxPiece).toBeGreaterThan(120);
    expect(result.tetrises).toBeGreaterThan(3);
    expect(result.otherClears, 'the hunter must not settle for singles/doubles/triples').toBe(0);
    expect(result.maxLines).toBe(result.tetrises * 4);
  });

  test('a short run stops cleanly and the game stays responsive', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/tests/harness/bot-runner.html');
    const result = await page.evaluate(() => window.botRunner.run({
      botUrl: '/bots/dist/four-line-fanatic.js',
      seed: 'deepseek',
      timeLimitMs: 3_000,
    }));
    // Stopping the bot mid-match pauses the game; that must not throw.
    expect(result.error).toBeNull();
    expect(result.maxPiece).toBeGreaterThan(10);
  });
});
