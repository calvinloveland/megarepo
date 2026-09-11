import { expect, test } from "@playwright/test";

type ModeId = "menu" | "world" | "evolution" | "test-drive";

interface RunStateSnapshot {
  mode: "evolution" | "test-drive";
  terrainName: string;
  generation: number;
  population: Array<{ id: string; dna: string }>;
}

interface GenerationLogEntry {
  runId: string;
  generation: number;
  terrainName: string;
  populationSize: number;
}

const baseUrl = process.env.VROOMON_E2E_BASE_URL;

if (!baseUrl) {
  throw new Error("VROOMON_E2E_BASE_URL is required for the Playwright harness.");
}

test.beforeEach(async ({ page }) => {
  await page.goto(`${baseUrl}/dist/renderer/e2e.html`);
  await expect(page.locator("[data-status-message]")).toContainText(
    "Welcome to",
  );
});

test.describe("vroomon Playwright harness", () => {
  test("switches visible panels and active mode buttons", async ({ page }) => {
    await expectModeState(page, "menu");
    await expect(page.locator("[data-status-message]")).toContainText(
      "Welcome to the Continent of Vroom.",
    );
    await expect(page.locator("[data-race-viewport] [data-viewport-vehicle]")).toHaveCount(1);
    await expect(page.locator("[data-run-state-output]")).toContainText('"generation": 0');

    await page.locator('[data-mode-button="evolution"]').click();
    await expectModeState(page, "evolution");
    await expect(page.locator("[data-status-message]")).toContainText(
      "Viewing evolution mode.",
    );
    await expect(page.locator("[data-race-viewport] [data-viewport-vehicle]")).not.toHaveCount(0);
    await expect(page.locator("[data-evolution-preview-output]")).toContainText(
      '"generatedPopulation"',
    );
    await expect(page.locator("[data-selected-vehicle-output]")).toContainText(
      "Run a generation to inspect a selected car.",
    );

    await page.locator('[data-mode-button="test-drive"]').click();
    await expectModeState(page, "test-drive");
    await expect(page.locator("[data-status-message]")).toContainText(
      "Viewing test-drive mode.",
    );
    await expect(page.locator("[data-race-viewport] [data-viewport-vehicle]")).toHaveCount(1);
    await expect(page.locator("[data-dna-output]")).toContainText('"dna"');
    await expect(page.locator("[data-physics-preview-output]")).toContainText(
      '"terrainName"',
    );

    await page.locator('[data-mode-button="menu"]').click();
    await expectModeState(page, "menu");
    await expect(page.locator("[data-status-message]")).toContainText(
      "Viewing the main menu.",
    );
  });

  test("updates the test-drive preview when controls change", async ({ page }) => {
    await page.locator('[data-mode-button="test-drive"]').click();
    await expectModeState(page, "test-drive");

    const initialDna = await readJson<{ dna: string }>(page, "[data-dna-output]");

    await page.locator("[data-terrain-select]").selectOption("Flat");
    await expect
      .poll(
        async () =>
          (await readJson<{ terrainName: string }>(page, "[data-physics-preview-output]"))
            .terrainName,
      )
      .toBe("Flat");

    await page.locator("[data-randomize-dna]").click();
    await expect
      .poll(async () => (await readJson<{ dna: string }>(page, "[data-dna-output]")).dna)
      .not.toBe(initialDna.dna);
    await expect(page.locator("[data-selected-vehicle-summary]")).toContainText("Wheel count");
  });

  test("loads the flat-track regression replay in test-drive mode", async ({ page }) => {
    await page.locator('[data-mode-button="test-drive"]').click();
    await page.locator("[data-watch-flat-track-regression]").click();

    await expect(page.locator("[data-status-message]")).toContainText(
      "Watching flat-track regression replay.",
    );
    await expect(page.locator("[data-terrain-select]")).toHaveValue("Flat");
    await expect(page.locator("[data-test-drive-summary]")).toContainText(
      "flat-track regression replay",
    );

    await expect
      .poll(async () => (await readJson<{ dna: string }>(page, "[data-dna-output]")).dna)
      .toBe("aaaaaaaaaaaa");
    await expect
      .poll(
        async () =>
          (
            await readJson<{
              scenarioLabel: string | null;
              stepCount: number;
              playbackDurationMs: number | null;
              wheelCount: number;
            }>(page, "[data-physics-preview-output]")
          ),
      )
      .toMatchObject({
        scenarioLabel: "flat-track regression replay",
        stepCount: 11_000,
        playbackDurationMs: 12_000,
        wheelCount: 2,
      });
  });

  test("supports evolution flow buttons end to end", async ({ page }) => {
    await page.locator('[data-mode-button="test-drive"]').click();
    const initialDna = await readJson<{ dna: string }>(page, "[data-dna-output]");
    await page.locator("[data-randomize-dna]").click();
    await expect
      .poll(async () => (await readJson<{ dna: string }>(page, "[data-dna-output]")).dna)
      .not.toBe(initialDna.dna);

    await page.locator('[data-mode-button="evolution"]').click();
    await page.locator("[data-terrain-select]").selectOption("Flat");
    await page.locator("[data-generate-population]").click();
    await expect(page.locator("[data-status-message]")).toContainText("Generated population");

    const generatedState = await readJson<RunStateSnapshot>(page, "[data-run-state-output]");
    expect(generatedState.mode).toBe("evolution");
    expect(generatedState.terrainName).toBe("Flat");
    expect(generatedState.generation).toBe(0);
    expect(generatedState.population.length).toBeGreaterThan(0);

    await page.locator("[data-run-generation]").click();
    await expect(page.locator("[data-status-message]")).toContainText(
      "Completed generation 1",
    );
    await expect(page.locator("[data-race-viewport] [data-viewport-vehicle]")).not.toHaveCount(0);

    const advancedState = await readJson<RunStateSnapshot>(page, "[data-run-state-output]");
    expect(advancedState.mode).toBe("evolution");
    expect(advancedState.terrainName).toBe("Flat");
    expect(advancedState.generation).toBe(1);
    expect(advancedState.population.length).toBe(generatedState.population.length);

    const vehicleButtons = page.locator("[data-select-vehicle]");
    await expect(vehicleButtons).not.toHaveCount(0);

    const targetIndex = (await vehicleButtons.count()) > 1 ? 1 : 0;
    const targetVehicleId =
      (await vehicleButtons.nth(targetIndex).getAttribute("data-select-vehicle")) ?? "";
    await vehicleButtons.nth(targetIndex).click();
    await expect(vehicleButtons.nth(targetIndex)).toHaveClass(/active/);

    await expect
      .poll(
        async () =>
          (await readJson<{ id: string }>(page, "[data-selected-vehicle-output]")).id,
      )
      .toBe(targetVehicleId);
    await expect(page.locator("[data-selected-vehicle-summary]")).toContainText(targetVehicleId);

    const generationLog = await readJson<GenerationLogEntry[]>(
      page,
      "[data-generation-log-output]",
    );
    expect(generationLog[0]).toMatchObject({
      generation: 1,
      terrainName: "Flat",
      populationSize: generatedState.population.length,
    });
  });

  test("walks through the overworld and triggers a wild encounter", async ({ page }) => {
    await page.locator('[data-mode-button="world"]').click();
    await expectModeState(page, "world");

    await expect(page.locator("[data-overworld-canvas]")).toBeVisible();
    await expect(page.locator("[data-overworld-vroomdex-count]")).toContainText("0 specimens");
    await expect(page.locator("[data-overworld-badge-list]")).toContainText("No brands");

    // Player starts at (7, 7). Professor Axle is at (4, 3), so we need
    // to move left 3 tiles then up 3 tiles to stand at (4, 4) facing up.
    await page.locator("[data-dpad=\"left\"]").click();
    await page.locator("[data-dpad=\"left\"]").click();
    await page.locator("[data-dpad=\"left\"]").click();
    await page.locator("[data-dpad=\"up\"]").click();
    await page.locator("[data-dpad=\"up\"]").click();
    await page.locator("[data-dpad=\"up\"]").click();
    await page.locator('[data-dpad="interact"]').click();

    await expect(page.locator("[data-overworld-dialogue]")).toBeVisible();
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Professor Axle");
  });

  test("saves and reloads the current run state via keyboard shortcuts", async ({ page }) => {
    await page.locator('[data-mode-button="test-drive"]').click();
    await page.locator("[data-terrain-select]").selectOption("Flat");
    await page.keyboard.press("s");

    await expect(page.locator("[data-status-message]")).toContainText("Saved run state");

    await page.locator('[data-mode-button="evolution"]').click();
    await page.locator("[data-terrain-select]").selectOption("Grassland");
    await page.keyboard.press("l");

    await expect(page.locator("[data-status-message]")).toContainText("Loaded run");
    await expect(page.locator('[data-mode-button="test-drive"]')).toHaveClass(/active/);
    await expect(page.locator("[data-terrain-select]")).toHaveValue("Flat");

    const loadedState = await readJson<RunStateSnapshot>(page, "[data-run-state-output]");
    expect(loadedState.mode).toBe("test-drive");
    expect(loadedState.terrainName).toBe("Flat");
  });

  test("runs a batch of generations from the evolution panel", async ({ page }) => {
    await page.locator('[data-mode-button="evolution"]').click();
    await page.locator("[data-terrain-select]").selectOption("Flat");
    await page.locator("[data-generate-population]").click();
    await expect(page.locator("[data-status-message]")).toContainText("Generated population");

    await page.locator("[data-run-batch-generations]").click();

    await expect(page.locator("[data-batch-progress]")).toBeVisible();
    await expect(page.locator("[data-status-message]")).toContainText(
      /Batch complete|Converged/,
      { timeout: 60_000 },
    );

    const finalState = await readJson<RunStateSnapshot>(page, "[data-run-state-output]");
    // Batch runs 10 generations with convergence detection on. The exact
    // generation count depends on when the scores plateau.
    expect(finalState.generation).toBeGreaterThanOrEqual(3);
    expect(finalState.generation).toBeLessThanOrEqual(10);
  });

  test("saves a selected vehicle to the Hall of Fame and reloads it in test-drive", async ({
    page,
  }) => {
    await page.locator('[data-mode-button="evolution"]').click();
    await page.locator("[data-terrain-select]").selectOption("Flat");
    await page.locator("[data-generate-population]").click();
    await page.locator("[data-run-generation]").click();

    await expect(page.locator("[data-status-message]")).toContainText("Completed generation 1");

    const vehicleButtons = page.locator("[data-select-vehicle]");
    await expect(vehicleButtons).not.toHaveCount(0);
    await vehicleButtons.first().click();

    await page.locator("[data-save-selected-to-hall]").click();
    await expect(page.locator("[data-status-message]")).toContainText("Saved");

    await page.locator('[data-mode-button="test-drive"]').click();
    const hallEntry = page.locator("[data-hall-of-fame-test-drive] [data-hall-entry]").first();
    await expect(hallEntry).toHaveCount(1);

    const entryDna = await hallEntry.locator(".hall-entry__dna").textContent();
    // The HoF entries are in the hidden diagnostics section; dispatch a
    // native click to trigger the load-in-test-drive handler anyway.
    await hallEntry.dispatchEvent("click");

    await expect(page.locator("[data-dna-input]")).toHaveValue(entryDna ?? "");
  });

  test("hides mode-scoped overlays and paints the overworld canvas", async ({
    page,
  }) => {
    // Regression: .viewport-overlay--actions / --status / --progress used
    // display:flex, which defeated the UA [hidden] rule, so the evolution
    // HUD, test-drive HUD, leader pill and batch bar rendered in every
    // mode at once (and the config panel never collapsed).
    await expectModeState(page, "menu");
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="evolution"]')).toBeHidden();
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="test-drive"]')).toBeHidden();
    await expect(page.locator("[data-viewport-leader-pill]")).toBeHidden();
    await expect(page.locator("[data-viewport-progress-overlay]")).toBeHidden();
    await expect(page.locator("[data-config-panel]")).toBeHidden();

    // In evolution mode the evolution HUD shows and the drive HUD stays
    // hidden; the config toggle actually collapses now.
    await page.locator('[data-mode-button="evolution"]').click();
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="evolution"]')).toBeVisible();
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="test-drive"]')).toBeHidden();
    await page.locator("[data-config-toggle]").click();
    await expect(page.locator("[data-config-panel]")).toBeVisible();
    await page.locator("[data-config-toggle]").click();
    await expect(page.locator("[data-config-panel]")).toBeHidden();

    // Regression: the overworld canvas never painted (the rAF loop guard
    // was poisoned at boot). The backing store must hold real pixels.
    await page.locator('[data-mode-button="world"]').click();
    await expect(page.locator("[data-overworld-canvas]")).toBeVisible();
    // The gen pill and terrain select are meaningless in the overworld.
    await expect(page.locator("[data-viewport-gen-pill]")).toBeHidden();
    await expect(page.locator(".top-bar__terrain")).toBeHidden();
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-overworld-canvas]");
      if (!canvas) return -1;
      const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data) return -1;
      let colored = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) colored += 1;
      }
      return colored;
    });
    expect(painted).toBeGreaterThan(1000);
  });

  test("mode-switch keyboard shortcuts work inside the overworld", async ({
    page,
  }) => {
    // Regression: in world mode every keydown went to the overworld
    // handler, so 1-4/m/o/e/t silently did nothing and the player could
    // not leave the map via keyboard.
    await page.locator('[data-mode-button="world"]').click();
    await expectModeState(page, "world");
    await page.keyboard.press("3");
    await expectModeState(page, "evolution");
    await page.keyboard.press("2");
    await expectModeState(page, "world");
    await page.keyboard.press("m");
    await expectModeState(page, "menu");
    await page.keyboard.press("o");
    await expectModeState(page, "world");
    await page.keyboard.press("t");
    await expectModeState(page, "test-drive");
  });

  test("joins a Grassland faction from the Meadow Elder and persists it", async ({
    page,
  }) => {
    await page.locator('[data-mode-button="world"]').click();
    await expectModeState(page, "world");
    // Elder is at (2,9) facing right; stand at (3,9) facing left.
    for (const dir of ["down", "down", "left", "left", "left", "left"]) {
      await page.locator(`[data-dpad="${dir}"]`).click();
      await page.waitForTimeout(320);
    }
    await page.locator('[data-dpad="interact"]').click();
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Meadow Elder");
    await page.keyboard.press("z");
    await page.waitForTimeout(250);

    // Choose the Greensprouts.
    await page.locator("[data-dialogue-option]").first().click();
    await page.waitForTimeout(250);
    await page.locator("[data-overworld-dialogue-text]").waitFor();
    await page.keyboard.press("z"); // advance past the join text
    await page.waitForTimeout(400);

    await expect(page.locator("[data-status-message]")).toContainText("You ride for");
    // Persisted + surfaced in the stats HUD.
    await page.locator('[data-mode-button="evolution"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-mode-button="world"]').click();
    await page.waitForTimeout(500);
    await expect
      .poll(async () =>
        page.locator("[data-viewport-stats-overlay]").textContent(),
      )
      .toContain("HOUSES");
    await expect
      .poll(async () =>
        page.locator("[data-viewport-stats-overlay]").textContent(),
      )
      .toContain("1");
  });
});

async function expectModeState(
  page: import("@playwright/test").Page,
  activeMode: ModeId,
): Promise<void> {
  const modes: ModeId[] = ["menu", "world", "evolution", "test-drive"];

  for (const mode of modes) {
    const button = page.locator(`[data-mode-button="${mode}"]`);
    const isActive = mode === activeMode;

    if (isActive) {
      await expect(button).toHaveClass(/active/);
    } else {
      await expect(button).not.toHaveClass(/active/);
    }
  }
}

async function readJson<T>(page: import("@playwright/test").Page, selector: string): Promise<T> {
  const text = await page.locator(selector).textContent();

  if (!text) {
    throw new Error(`Expected JSON content in ${selector}.`);
  }

  return JSON.parse(text) as T;
}

  test("shows the arcade menu screen and starts a run", async ({ page }) => {
    // Menu overlay is visible on boot (menu mode) with the VROOMON wordmark.
    await expectModeState(page, "menu");
    const menuOverlay = page.locator("[data-viewport-menu-overlay]");
    await expect(menuOverlay).toBeVisible();
    await expect(menuOverlay.locator(".menu-title")).toHaveText("VROOMON");
    await expect(menuOverlay.locator('[data-menu-action="new-run"]')).toBeVisible();
    await expect(menuOverlay.locator('[data-menu-action="world"]')).toBeVisible();
    await expect(menuOverlay.locator('[data-menu-action="continue"]')).toBeVisible();

    // The menu overlay must not leak into other modes.
    await page.locator('[data-mode-button="evolution"]').click();
    await expect(menuOverlay).toBeHidden();
    await page.locator('[data-mode-button="menu"]').click();
    await expect(menuOverlay).toBeVisible();

    // "NEW RUN" starts a fresh run and drops the player into evolution mode.
    await page.locator('[data-menu-action="new-run"]').click();
    await expect(page.locator("[data-status-message]")).toContainText("Generated population");
    await expectModeState(page, "evolution");

    // Enter / Space also starts from the menu.
    await page.locator('[data-mode-button="menu"]').click();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-status-message]")).toContainText("Generated population");
    await expectModeState(page, "evolution");
  });

  test("shows the player stats HUD with mode-scoped values", async ({ page }) => {
    // Hidden on the menu start screen.
    await expectModeState(page, "menu");
    await expect(page.locator("[data-viewport-stats-overlay]")).toBeHidden();

    const chipText = async (): Promise<string[]> =>
      page
        .locator("[data-viewport-stats-overlay] .stats-chip")
        .allTextContents();

    // Evolution: wallet/generation/population chips appear after a run.
    await page.locator('[data-mode-button="evolution"]').click();
    await page.locator("[data-generate-population]").click();
    await page.locator("[data-status-message]").filter({ hasText: "Generated population" }).waitFor({ timeout: 15000 });
    await page.locator("[data-run-generation]").click();
    await page.locator("[data-status-message]").filter({ hasText: "Completed generation" }).waitFor({ timeout: 20000 });
    const evoChips = await chipText();
    expect(evoChips.join(" ")).toContain("BEST");
    expect(evoChips.join(" ")).toContain("POP");
    expect(evoChips.join(" ")).toContain("GEN");
    expect(evoChips.join(" ")).toContain("WALLET");

    // World: map/badges/vroomdex chips.
    await page.locator('[data-mode-button="world"]').click();
    await page.waitForTimeout(500);
    const worldChips = await chipText();
    expect(worldChips.join(" ")).toContain("MAP");
    expect(worldChips.join(" ")).toContain("HOUSES");
    expect(worldChips.join(" ")).toContain("DEX");
  });
