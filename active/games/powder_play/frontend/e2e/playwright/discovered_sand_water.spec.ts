import { test, expect } from "@playwright/test";
import { loadMaterialByName } from "./helpers/materials";

test("sand + water mix appears in discovered list", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__mixApiBase = "http://127.0.0.1:1";
    const mixName = "SiltMist";
    const key = ["Sand", "Water"].sort().join("|");
    const cache: Record<string, any> = {};
    cache[key] = {
      type: "material",
      name: mixName,
      description: "Cached sand+water mix",
      tags: ["sand"],
      density: 1.4,
      color: [180, 170, 140],
    };
    localStorage.setItem("alchemistPowder.mixCache.version", "v2");
    localStorage.setItem("alchemistPowder.mixCache.v2", JSON.stringify(cache));
  });

  await page.goto("http://127.0.0.1:5173/");
  await page.waitForSelector("text=Alchemist Powder");

  await loadMaterialByName(page, "Sand");
  await loadMaterialByName(page, "Water");

  await page.waitForFunction(() => {
    const map = (window as any).__materialIdByName || {};
    return !!(window as any).__powderWorker && !!map.Sand && !!map.Water;
  });

  await page.evaluate(() => {
    const map = (window as any).__materialIdByName || {};
    const worker = (window as any).__powderWorker;
    if (!worker) return;
    const sandId = map.Sand;
    const waterId = map.Water;
    if (!sandId || !waterId) return;
    worker.postMessage({
      type: "paint_points",
      materialId: sandId,
      points: [{ x: 70, y: 70 }],
    });
    worker.postMessage({
      type: "paint_points",
      materialId: waterId,
      points: [{ x: 71, y: 70 }],
    });
    worker.postMessage({ type: "step" });
  });

  await expect(page.locator("#discovered-section")).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator("#discovered-list")).toContainText("SiltMist");
});
