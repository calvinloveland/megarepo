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
    "Ready to begin",
  );
});

test.describe("vroomon Playwright harness", () => {
  test("switches visible panels and active mode buttons", async ({ page }) => {
    await expectModeState(page, "menu");
    await expect(page.locator("[data-status-message]")).toContainText(
      "Ready to begin the Electron rewrite preview.",
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
      (await vehicleButtons.nth(targetIndex).textContent())?.trim() ?? "";
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
    await expect(page.locator("[data-overworld-badge-list]")).toContainText("No badges");

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

    await page.locator("[data-save-to-hall]").click();
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
