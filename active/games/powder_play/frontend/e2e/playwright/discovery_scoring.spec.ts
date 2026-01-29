import { test, expect } from "@playwright/test";

test("discovering elements awards points and Gold gives big bonus", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForSelector("text=Alchemist Powder");
  await page.waitForFunction(
    () => (window as any).__mixCacheReady === true,
    null,
    { timeout: 10000 },
  );

  // ensure clean score
  await page.evaluate(() => localStorage.removeItem("alchemistPowder.discovery.score"));

  // Discover a non-Gold element
  await page.evaluate(() => {
    (window as any).__addDiscoveredMaterial?.({ name: "Oxygen", color: [120,180,255], tags: ["element","float"], atomicNumber: 8 });
  });

  // small score should be visible
  const scoreVal = page.locator("#discovery-score-value");
  await expect(scoreVal).toHaveText(/\d+/);
  const firstScore = Number((await scoreVal.textContent()) || "0");
  expect(firstScore).toBeGreaterThan(0);

  // Discover Gold and expect a large jump
  await page.evaluate(() => {
    (window as any).__addDiscoveredMaterial?.({ name: "Gold", color: [212,175,55], tags: ["element","static"], atomicNumber: 79 });
  });

  const newScore = Number((await scoreVal.textContent()) || "0");
  expect(newScore).toBeGreaterThan(firstScore + 1000); // Gold should add a big bonus
});