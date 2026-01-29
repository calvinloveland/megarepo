import { test, expect } from "@playwright/test";
import { loadMaterialByName } from "./helpers/materials";
import { createFailureLogger } from "./helpers/failure_logger";

test("fire burns out completely", async ({ page }, testInfo) => {
  const logger = createFailureLogger(testInfo, page);
  let failed = false;
  try {
    await page.goto("http://127.0.0.1:5173/");
    await page.waitForSelector("text=Alchemist Powder");

    await loadMaterialByName(page, "Fire");
    await page.click("#play-btn");

    await page.evaluate(() => {
      (window as any).__paintGridPoints?.([{ x: 75, y: 50 }]);
    });

    await page.waitForFunction(
      () => (window as any).__lastGrid && (window as any).__lastGridWidth,
      null,
      { timeout: 5000 },
    );

    const success = await page.waitForFunction(() => {
      const grid = (window as any).__lastGrid as Uint16Array | undefined;
      const ids = (window as any).__materialIdByName || {};
      const fireId = ids.Fire;
      if (!grid || !fireId) return false;
      let count = 0;
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === fireId) count++;
      }
      return count === 0;
    }, null, { timeout: 5000 });

    expect(success).toBeTruthy();
  } catch (err) {
    failed = true;
    try {
      const counts = await page.evaluate(() => {
        const grid = (window as any).__lastGrid as Uint16Array | undefined;
        const ids = (window as any).__materialIdByName || {};
        const fireId = ids.Fire;
        let count = 0;
        if (grid && fireId) {
          for (let i = 0; i < grid.length; i++) {
            if (grid[i] === fireId) count++;
          }
        }
        return { fireId, count };
      });
      logger.log("fire count", counts);
    } catch (e) {
      logger.log("fire count fetch failed", String(e));
    }
    throw err;
  } finally {
    logger.flush(failed);
  }
});
