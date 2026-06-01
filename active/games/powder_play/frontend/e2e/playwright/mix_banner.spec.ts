import { test, expect } from "@playwright/test";

test("mix banner shows while generating new material", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForSelector("text=Alchemist Powder");
  await page.waitForFunction(
    () => (window as any).__mixCacheReady === true,
    null,
    { timeout: 10000 },
  );

  // Register two unique materials so the mix is guaranteed to be uncached
  const { nameA, nameB } = await page.evaluate(() => {
    const suffix = Date.now().toString();
    const a = {
      type: "material",
      name: `MixTestA_${suffix}`,
      description: "A",
      tags: ["sand"],
      density: 1.3,
      color: [200, 180, 120],
    };
    const b = {
      type: "material",
      name: `MixTestB_${suffix}`,
      description: "B",
      tags: ["flow"],
      density: 1.0,
      color: [80, 120, 200],
    };
    (window as any).__initWorkerWithMaterial?.(a);
    (window as any).__initWorkerWithMaterial?.(b);
    return { nameA: a.name, nameB: b.name };
  });

  // Trigger mix generation explicitly
  await page.evaluate(
    ({ nameA, nameB }) => {
      (window as any).__triggerMixForNames?.(nameA, nameB);
    },
    { nameA, nameB },
  );

  // Banner should appear with mix message
  const banner = page.locator("#mix-banner");
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText("New material discovered");
});

test("mix banner hides after mix completes", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForSelector("text=Alchemist Powder");
  await page.waitForFunction(
    () => (window as any).__mixCacheReady === true,
    null,
    { timeout: 10000 },
  );

  // Register unique materials
  const { nameA, nameB } = await page.evaluate(() => {
    const suffix = Date.now().toString();
    const a = {
      type: "material",
      name: `BannerHideA_${suffix}`,
      description: "A",
      tags: ["sand"],
      density: 1.3,
      color: [200, 180, 120],
    };
    const b = {
      type: "material",
      name: `BannerHideB_${suffix}`,
      description: "B",
      tags: ["flow"],
      density: 1.0,
      color: [80, 120, 200],
    };
    (window as any).__initWorkerWithMaterial?.(a);
    (window as any).__initWorkerWithMaterial?.(b);
    return { nameA: a.name, nameB: b.name };
  });

  const banner = page.locator("#mix-banner");

  // Banner should be hidden initially
  await expect(banner).toBeHidden({ timeout: 2000 });

  // Trigger mix
  await page.evaluate(
    ({ nameA, nameB }) => {
      (window as any).__triggerMixForNames?.(nameA, nameB);
    },
    { nameA, nameB },
  );

  // Banner should appear
  await expect(banner).toBeVisible({ timeout: 5000 });

  // Banner should disappear after mix completes (within 30s for LLM call)
  await expect(banner).toBeHidden({ timeout: 35000 });

  // Verify the material was actually discovered
  const discoveredExists = await page.evaluate(() => {
    const list = (window as any).__discoveredMaterials || [];
    return list.length > 0;
  });
  expect(discoveredExists).toBe(true);
});

test("mix banner hides even when LLM call fails", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForSelector("text=Alchemist Powder");
  await page.waitForFunction(
    () => (window as any).__mixCacheReady === true,
    null,
    { timeout: 10000 },
  );

  // Override mix API base to a broken URL so LLM calls fail
  await page.evaluate(() => {
    (window as any).__mixApiBase = "http://127.0.0.1:1";
  });

  // Register materials
  const { nameA, nameB } = await page.evaluate(() => {
    const suffix = Date.now().toString();
    const a = {
      type: "material",
      name: `BannerFailA_${suffix}`,
      description: "A",
      tags: ["sand"],
      density: 1.3,
      color: [200, 180, 120],
    };
    const b = {
      type: "material",
      name: `BannerFailB_${suffix}`,
      description: "B",
      tags: ["flow"],
      density: 1.0,
      color: [80, 120, 200],
    };
    (window as any).__initWorkerWithMaterial?.(a);
    (window as any).__initWorkerWithMaterial?.(b);
    return { nameA: a.name, nameB: b.name };
  });

  const banner = page.locator("#mix-banner");

  // Trigger mix — LLM calls will fail because API base is broken
  await page.evaluate(
    ({ nameA, nameB }) => {
      (window as any).__triggerMixForNames?.(nameA, nameB);
    },
    { nameA, nameB },
  );

  // Banner should appear briefly
  await expect(banner).toBeVisible({ timeout: 5000 });

  // Banner should disappear after the timeout + error handling (within 20s)
  await expect(banner).toBeHidden({ timeout: 25000 });
});

test("touch events work on simulation canvas", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForSelector("text=Alchemist Powder");
  await page.waitForFunction(
    () => (window as any).__mixCacheReady === true,
    null,
    { timeout: 10000 },
  );

  // Ensure at least one material is loaded
  await page.evaluate(() => {
    const a = {
      type: "material",
      name: `TouchTest_${Date.now()}`,
      tags: ["sand"],
      density: 1.0,
      color: [200, 100, 100],
    };
    (window as any).__initWorkerWithMaterial?.(a);
  });

  // Use Playwright's touch emulation
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const canvas = page.locator("#sim-canvas");
  await expect(canvas).toBeVisible();

  // Simulate touchstart + touchmove + touchend on the canvas
  const box = await canvas.boundingBox();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  await page.touchscreen.tap(startX, startY);

  // Step the simulation to process the paint
  await page.evaluate(() => {
    const w = (window as any).__powderWorker;
    if (w) w.postMessage({ type: "step" });
  });
  await page.waitForTimeout(300);

  // After a touch paint, the grid should have some non-zero cells
  const hasPaintedCells = await page.evaluate(() => {
    const grid = (window as any).__lastGrid;
    if (!grid) return false;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > 0) return true;
    }
    return false;
  });
  expect(hasPaintedCells).toBe(true);
});
