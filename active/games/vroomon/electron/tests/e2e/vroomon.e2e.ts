import { expect, test } from "@playwright/test";

type ModeId = "menu" | "evolution" | "test-drive";

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
    await expect(page.locator("[data-run-state-output]")).toContainText('"generation": 0');

    await page.locator('[data-mode-button="evolution"]').click();
    await expectModeState(page, "evolution");
    await expect(page.locator("[data-status-message]")).toContainText(
      "Viewing evolution mode.",
    );
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

  test("saves and reloads the current run state", async ({ page }) => {
    await page.locator('[data-mode-button="test-drive"]').click();
    await page.locator("[data-terrain-select]").selectOption("Flat");
    await page.locator("[data-save-run]").click();

    await expect(page.locator("[data-status-message]")).toContainText("Saved run state");

    await page.locator('[data-mode-button="evolution"]').click();
    await page.locator("[data-terrain-select]").selectOption("Grassland");
    await page.locator("[data-load-run]").click();

    await expect(page.locator("[data-status-message]")).toContainText("Loaded run");
    await expect(page.locator('[data-panel="test-drive"]')).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.locator("[data-terrain-select]")).toHaveValue("Flat");

    const loadedState = await readJson<RunStateSnapshot>(page, "[data-run-state-output]");
    expect(loadedState.mode).toBe("test-drive");
    expect(loadedState.terrainName).toBe("Flat");
  });
});

async function expectModeState(
  page: import("@playwright/test").Page,
  activeMode: ModeId,
): Promise<void> {
  const modes: ModeId[] = ["menu", "evolution", "test-drive"];

  for (const mode of modes) {
    const button = page.locator(`[data-mode-button="${mode}"]`);
    const panel = page.locator(`[data-panel="${mode}"]`);
    const isActive = mode === activeMode;

    if (isActive) {
      await expect(button).toHaveClass(/active/);
      await expect(panel).toHaveAttribute("data-active", "true");
      await expect(panel).toBeVisible();
    } else {
      await expect(button).not.toHaveClass(/active/);
      await expect(panel).toHaveAttribute("data-active", "false");
      await expect(panel).toBeHidden();
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
