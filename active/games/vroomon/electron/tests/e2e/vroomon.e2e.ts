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
    await expect(page.locator("[data-race-viewport] [data-viewport-vehicle]")).not.toHaveCount(0);
    await expect(page.locator("[data-run-state-output]")).toContainText('"generation": 0');

    // Into the world, then the carrier hub on the herd bench.
    await seedAndEnterWorld(page);
    await expectModeState(page, "world");

    await openPocketRanch(page, "herd");
    await expectModeState(page, "evolution");
    await expect(page.locator("[data-status-message]")).toContainText(
      "herd bench hums",
    );
    await expect(page.locator("[data-race-viewport] [data-viewport-vehicle]")).not.toHaveCount(0);
    await expect(page.locator("[data-evolution-preview-output]")).toContainText(
      '"generatedPopulation"',
    );
    await expect(page.locator("[data-selected-vehicle-output]")).toContainText(
      "Run a generation to inspect a selected car.",
    );

    await openPocketRanch(page, "drive");
    await expectModeState(page, "test-drive");
    await expect(page.locator("[data-status-message]")).toContainText(
      "paddock gate rolls back",
    );
    await expect(page.locator("[data-race-viewport] [data-viewport-vehicle]")).toHaveCount(1);
    await expect(page.locator("[data-dna-output]")).toContainText('"dna"');
    await expect(page.locator("[data-physics-preview-output]")).toContainText(
      '"terrainName"',
    );

    await closePocketRanch(page);
    await expectModeState(page, "world");
    await expect(page.locator("[data-status-message]")).toContainText(
      "Back on the road",
    );
  });

  test("updates the test-drive preview when controls change", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "drive");
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
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "drive");
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

  test("@smoke supports evolution flow buttons end to end", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "drive");
    const initialDna = await readJson<{ dna: string }>(page, "[data-dna-output]");
    await page.locator("[data-randomize-dna]").click();
    await expect
      .poll(async () => (await readJson<{ dna: string }>(page, "[data-dna-output]")).dna)
      .not.toBe(initialDna.dna);

    await openPocketRanch(page, "herd");
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

  test("@smoke walks through the overworld and triggers a wild encounter", async ({ page }) => {
    await seedAndEnterWorld(page);
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
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "drive");
    await page.locator("[data-terrain-select]").selectOption("Flat");
    await page.keyboard.press("s");

    await expect(page.locator("[data-status-message]")).toContainText("Saved run state");

    await openPocketRanch(page, "herd");
    await page.locator("[data-terrain-select]").selectOption("Grassland");
    await page.keyboard.press("l");

    await expect(page.locator("[data-status-message]")).toContainText("Loaded run");
    await expect(page.locator('[data-barn-pill="drive"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-terrain-select]")).toHaveValue("Flat");

    const loadedState = await readJson<RunStateSnapshot>(page, "[data-run-state-output]");
    expect(loadedState.mode).toBe("test-drive");
    expect(loadedState.terrainName).toBe("Flat");
  });

  test("runs a batch of generations from the evolution panel", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
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
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-terrain-select]").selectOption("Flat");
    await page.locator("[data-generate-population]").click();
    await page.locator("[data-run-generation]").click();

    await expect(page.locator("[data-status-message]")).toContainText("Completed generation 1");

    const vehicleButtons = page.locator("[data-select-vehicle]");
    await expect(vehicleButtons).not.toHaveCount(0);
    await vehicleButtons.first().click();

    await page.locator("[data-save-selected-to-hall]").click();
    await expect(page.locator("[data-status-message]")).toContainText("Saved");

    await openPocketRanch(page, "drive");
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
    await seedRancher(page);
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

    // In the herd scene the evolution HUD shows and the drive HUD stays
    // hidden; the config toggle actually collapses now.
    await enterWorld(page);
    await openPocketRanch(page, "herd");
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="evolution"]')).toBeVisible();
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="test-drive"]')).toBeHidden();
    await page.locator("[data-config-toggle]").click();
    await expect(page.locator("[data-config-panel]")).toBeVisible();
    await page.locator("[data-config-toggle]").click();
    await expect(page.locator("[data-config-panel]")).toBeHidden();

    // Regression: the overworld canvas never painted (the rAF loop guard
    // was poisoned at boot). The backing store must hold real pixels.
    await closePocketRanch(page);
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

  test("@smoke the carrier hub walks between herd, paddock, barn, and the road", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    await expectModeState(page, "world");

    await openPocketRanch(page, "herd");
    await expectModeState(page, "evolution");
    await openPocketRanch(page, "drive");
    await expectModeState(page, "test-drive");
    await openPocketRanch(page, "barn");
    await expect(page.locator('[data-barn-scene="barn"]')).toBeVisible();
    await expect(page.locator('[data-barn-pill="barn"]')).toHaveAttribute("aria-pressed", "true");

    // Escape (or the close button) puts the rancher back on the road.
    await page.keyboard.press("Escape");
    await expectModeState(page, "world");
    await expect(page.locator("[data-status-message]")).toContainText("Back on the road");
  });

  test("joins a Grassland faction from the Meadow Elder and persists it", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
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
    await openPocketRanch(page, "herd");
    await page.waitForTimeout(300);
    await closePocketRanch(page);
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
  test("buys meadow decor and it persists across a reload", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.locator("[data-status-message]").filter({ hasText: "Generated population" }).waitFor({ timeout: 20000 });
    let wallet = 0;
    for (let i = 0; i < 10; i += 1) {
      wallet = (await readJson<{ wallet: number }>(page, "[data-run-state-output]")).wallet;
      if (wallet >= 10) break;
      await page.locator("[data-run-generation]").click();
      await page.locator("[data-status-message]").filter({ hasText: "Completed generation" }).waitFor({ timeout: 30000 });
    }
    expect(wallet).toBeGreaterThanOrEqual(10);
    await page.locator("[data-open-ranch]").click();
    await page.waitForTimeout(300);
    await expect(page.locator("[data-ranch-decor-list] .ranch-card")).toHaveCount(12);
    await page.locator("[data-buy-decor='sunflower-bower']").click();
    await page.waitForTimeout(600);
    const afterBuy = await readJson<{ wallet: number }>(page, "[data-run-state-output]");
    expect(afterBuy.wallet).toBe(wallet - 10);

    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    const persisted = await page.evaluate(() => window.vroomon.loadWorldState());
    expect(persisted.decor).toContain("sunflower-bower");
    // The meadow draws it: canvas checksum changes when decorated.
    await enterWorld(page);
    await page.waitForTimeout(1200);
    const decorated = await page.evaluate(() => {
      const c = document.querySelector("[data-overworld-canvas]");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 16) sum += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7;
      return sum;
    });
    expect(decorated).toBeGreaterThan(0);
  });


  test("runs the Grand Roundup after all five Brands and a champion", async ({
    page,
  }) => {
    await seedRancher(page);
    const FIVE = [
      "Grassland Brand",
      "Salt Road Brand",
      "Highland Brand",
      "Canyon Brand",
      "Perimeter Brand",
    ];
    const seed = async (badges: string[], hall: boolean) => {
      await page.evaluate(
        async ({ b, hall }) => {
          await window.vroomon.saveWorldState({
            version: 1,
            currentMapId: "gym_1",
            playerX: 6,
            playerY: 5,
            playerFacing: "right",
            badges: b,
            factionChoices: {},
            decor: [],
            vroomdex: [],
            flags: {},
            rancherName: "E2E",
            rancherCap: "rust",
            lastSavedAt: "",
          });
          if (hall) {
            await window.vroomon.saveHallOfFame({
              version: 1,
              entries: [
                {
                  id: "hall-finale",
                  runId: "r",
                  dna: "1fOrDEtvOR",
                  name: "Finale Champion",
                  score: 1620,
                  terrainName: "Flat",
                  generation: 10,
                  savedAt: "2026-09-13T00:00:00.000Z",
                  notes: "",
                },
              ],
            });
          }
        },
        { b: badges, hall },
      );
      await page.reload();
      await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
      await enterWorld(page);
      await page.waitForTimeout(900);
    };
    const toKing = async () => {
      await page.locator('[data-dpad="right"]').click();
      await page.waitForTimeout(300);
      await page.locator('[data-dpad="up"]').click();
      await page.waitForTimeout(300);
      await page.locator('[data-dpad="interact"]').click();
      await page.waitForTimeout(500);
      await page.locator("[data-dialogue-option]").nth(3).click(); // Run the Grand Roundup
      await page.waitForTimeout(400);
      await page.keyboard.press("z");
      await page.waitForTimeout(600);
    };

    await seed([], false);
    await toKing();
    await expect(page.locator("[data-status-message]")).toContainText("five Brands");

    await seed(FIVE, true);
    await toKing();
    await expect(page.locator("[data-grand-roundup-overlay]")).toBeVisible();
    await expect(page.locator("[data-status-message]")).toContainText("enshrined");
    await expect(page.locator("[data-grand-roundup-champion]")).toContainText("Finale Champion");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("BRANDS");
    await page.screenshot({ path: "/tmp/vroomon-grand-roundup.png" });
    await page.locator("[data-grand-roundup-close]").click();
    await page.waitForTimeout(300);
    await expect(page.locator("[data-grand-roundup-overlay]")).toBeHidden();
  });


  test("@smoke the opening story: trip, new name, wake, wild catch, and town", async ({
    page,
  }) => {
    // Title screen: a fresh road offers only NEW GAME (CONTINUE appears
    // once a rancher exists).
    await expect(page.locator('[data-menu-action="new-game"]')).toHaveCount(1);
    await expect(page.locator("[data-menu-continue]")).toBeHidden();
    await expect(page.locator(".menu-hall")).toHaveCount(0);

    await page.locator('[data-menu-action="new-game"]').click();
    await page.waitForTimeout(650); // let the first monologue line finish typing
    await expect(page.locator("[data-intro-text]")).toContainText("Isles of Speid");
    // Enter advances (it must not loop back to the first beat), and
    // clicking the card advances too.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await expect(page.locator("[data-intro-text]")).toContainText("chance to start over");
    await page.locator("[data-intro-card], [data-intro-overlay]").first().click({ position: { x: 400, y: 400 } });
    await page.waitForTimeout(400);
    await expect(page.locator("[data-intro-text]")).toContainText("change my name");
    await page.keyboard.press("z");
    await page.waitForTimeout(550); // name step
    // The name moment.
    await expect(page.locator("[data-intro-title]")).toContainText("NEW NAME");
    await page.locator("[data-rancher-name]").fill("Cal");
    await page.locator('[data-rancher-cap="rust"]').click();
    await page.locator("[data-save-rancher]").click();
    await page.waitForTimeout(900);
    await expect(page.locator("[data-status-message]")).toContainText("Sunlight through the cabin shutters");
    await expectModeState(page, "world");
    const wakeQuest = await page.locator("[data-stats-quest-line]").textContent();
    expect(wakeQuest).toContain("Robby");

    // The kitchen call: meet Robby and learn what the "herd" really is.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, playerX: 6, playerY: 3, playerFacing: "right" });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await page.waitForTimeout(700);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Rancher Robby");
    const robbyOptions = await page.locator("[data-dialogue-option]").count();
    expect(robbyOptions).toBe(2);
    await page.locator("[data-dialogue-option]").nth(1).click(); // the cattle remark
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("nothing so tall on Speid");
    // Click through the reveal and yard-lesson beats (one sentence each).
    for (let i = 0; i < 7; i += 1) {
      await page.locator("[data-overworld-dialogue-text]").click();
      await page.waitForTimeout(300);
    }

    // The catch lesson: tall grass -> wild vroomon -> genome recorded.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, playerX: 2, playerY: 7, playerFacing: "right" });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await page.waitForTimeout(700);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("shivers");
    // Z springs the hidden hardworker; the genome is recorded and Robby's
    // praise beat auto-follows the first catch.
    await page.keyboard.press("z");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Rancher Robby");
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("wild one on your first morning");
    // The praise plays out one sentence per box (including the new
    // breeding-and-release lesson); the Barn button pulses until the
    // final farewell.
    for (let i = 0; i < 5; i += 1) {
      await page.locator("[data-overworld-dialogue-text]").click();
      await page.waitForTimeout(300);
    }
    const doneQuest = await page.locator("[data-stats-quest-line]").textContent();
    expect(doneQuest).toContain("garden gate");
    // The Herd Book carries the wild genome, viewable in the Barn panel.
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-herdbook-list]")).toContainText("wild");
    await closePocketRanch(page);

    // The carrier bench in the yard is the diegetic way into the hub.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        playerX: 5,
        playerY: 9,
        playerFacing: "right",
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Carrier Bench");
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(600);
    await expectModeState(page, "evolution");
    await expect(page.locator('[data-barn-pill="herd"]')).toHaveAttribute("aria-pressed", "true");
  });


  test("settles the Grassland feud with the Meadow Elder for a Brand", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    for (const dir of ["down", "down", "left", "left", "left", "left"]) {
      await page.locator(`[data-dpad="${dir}"]`).click();
      await page.waitForTimeout(320);
    }
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    // Third option on the Elder's menu: Race to settle the feud.
    await page.locator("[data-dialogue-option]").nth(2).click();
    await page.waitForTimeout(400);
    await page.keyboard.press("z");
    // The race-result card appears (countdown then result); dismiss it.
    await expect(page.locator("[data-race-overlay]")).toBeVisible();
    await page.locator("[data-race-close]").click();
    await page.waitForTimeout(300);
    await expect(page.locator("[data-race-overlay]")).toBeHidden();
    await expect(page.locator("[data-status-message]")).toContainText("Grassland Brand");
    await expect(page.locator("[data-overworld-badge-list]")).toContainText("Grassland Brand");
  });


  test("buys The Split + supplements, marks a stud line, and consumes a Calm Tonic", async ({
    page,
  }) => {
    // A car in the Record Barn (survives the reloads because the renderer
    // re-hydrates the hall from storage on boot).
    await page.evaluate(async () => {
      const state = await window.vroomon.loadRunState();
      await window.vroomon.saveHallOfFame({
        version: 1,
        entries: [
          {
            id: "hall-e2e-stud",
            runId: state?.runId ?? "run",
            dna: "E2EHALL0001",
            name: "E2E Stud",
            score: 999,
            terrainName: state?.terrainName ?? "Grassland",
            generation: state?.generation ?? 0,
            savedAt: new Date().toISOString(),
            notes: "",
          },
        ],
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    // Build a small herd and top the wallet up via the storage API (the
    // keyboard reload path re-hydrates rendererState from it).
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.locator("[data-run-generation]").click();
    await page.waitForTimeout(700);
    await page.keyboard.press("s"); // persist the herd into storage
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
      const state = await window.vroomon.loadRunState();
      await window.vroomon.saveRunState({ ...state, wallet: 1000 });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await openPocketRanch(page, "herd");
    await page.waitForTimeout(400);
    await page.keyboard.press("l");
    await page.waitForTimeout(600);

    // RANCH store: buy The Split (tier 1) + one Calm Tonic.
    await page.locator("[data-open-ranch]").dispatchEvent("click");
    await page.locator('[data-buy-upgrade="pens"]').dispatchEvent("click");
    await expect(page.locator("[data-status-message]")).toContainText("built to tier 1");
    await page.locator('[data-buy-supply="calm"]').dispatchEvent("click");
    await expect(page.locator("[data-ranch-toast]")).toContainText("Calm Tonic");
    await page.locator("[data-close-ranch]").click();
    await page.waitForTimeout(300);

    // The tonic fires on the next cycle — drive the exact API the Run Gen
    // button uses, then confirm the stock drains exactly once.
    const cycle = await page.evaluate(async () => {
      const state = await window.vroomon.loadRunState();
      const result = window.vroomon.runEvolutionGeneration(state);
      const next = window.vroomon.advanceRunState(state, result);
      return { consumed: result.suppliesConsumed, supplies: next.supplies };
    });
    expect(cycle.consumed).toEqual({ calm: 1, wild: 0 });
    expect(cycle.supplies).toEqual({ calm: 0, wild: 0 });

    // Record Barn: mark a car as stud — 2 slots now.
    await openPocketRanch(page, "barn");
    await page.waitForTimeout(400);
    const studButton = page.locator("[data-menu-hall-list] [data-hall-stud]").first();
    await expect(studButton).toHaveCount(1);
    await studButton.dispatchEvent("click");
    await expect(page.locator("[data-status-message]")).toContainText("stud line");
    const penIds = await page.evaluate(async () => (await window.vroomon.loadRunState()).penIds);
    expect(penIds?.length).toBeGreaterThanOrEqual(1);
  });


  test("copies DNA to the clipboard and seeds a herd from an import", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedRancher(page);

    // Registry: one champion in the Record Barn (survives the reload).
    await page.evaluate(async () => {
      const state = await window.vroomon.loadRunState();
      await window.vroomon.saveHallOfFame({
        version: 1,
        entries: [
          {
            id: "hall-copy-e2e",
            runId: state?.runId ?? "run",
            dna: "SHARECHAMP123",
            name: "Shared Champ",
            score: 1234,
            terrainName: state?.terrainName ?? "Grassland",
            generation: state?.generation ?? 0,
            savedAt: new Date().toISOString(),
            notes: "",
          },
        ],
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });

    // Copy the champion's DNA from the Record Barn scene.
    await enterWorld(page);
    await openPocketRanch(page, "barn");
    await page.waitForTimeout(400);
    await page.locator("[data-menu-hall-list] [data-hall-copy]").first().click();
    await page.waitForTimeout(500);
    await page.locator("[data-barn-close]").click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SHARECHAMP123");

    // Copy the test-drive draft DNA.
    await openPocketRanch(page, "drive");
    await page.locator("[data-copy-draft-dna]").click();
    await page.waitForTimeout(400);
    const draftDna = await page.locator("[data-dna-input]").inputValue();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(draftDna);

    // Seed a fresh herd from an imported string and confirm the top seed
    // carries it.
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.locator("[data-import-dna]").fill("A7SEED9ZZ");
    await page.locator("[data-seed-import-dna]").click();
    await page.waitForTimeout(400);
    await expect(page.locator("[data-status-message]")).toContainText("Seeded the herd with A7SEED9ZZ");
    await page.keyboard.press("s"); // persist the seeded herd
    await page.waitForTimeout(400);
    const seeded = await page.evaluate(async () => {
      const state = await window.vroomon.loadRunState();
      return state.population[0]?.dna;
    });
    expect(seeded).toBe("A7SEED9ZZ");
  });


  test("cycles the ambient sound pad and remembers the choice", async ({ page }) => {
    await seedRancher(page);
    const button = page.locator("[data-ambience-toggle]");
    await expect(button).toContainText("Sound: med");
    await button.click();
    await expect(button).toContainText("Sound: low");
    await button.click();
    await expect(button).toContainText("Sound: off");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("vroomon:ambience") ?? "{}"),
    );
    expect(stored.volume).toBe(0);

    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await expect(page.locator("[data-ambience-toggle]")).toContainText("Sound: off");

    // Entering the world (different ambient scene) must not throw.
    await enterWorld(page);
    await page.waitForTimeout(600);
    await expectModeState(page, "world");
    await expect(page.locator("[data-status-message]")).toContainText("road carries you");
  });


  test("records a Test Drive lap and lets you drive the record back", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "drive");
    // Let the viewport complete a lap (~3s sim loop) so the record fires.
    await expect(page.locator("[data-records-toast]")).toContainText("NEW Grassland RECORD", {
      timeout: 12000,
    });

    await seedRancher(page);
    await enterWorld(page);
    await openPocketRanch(page, "barn");
    await page.waitForTimeout(400);
    const rows = page.locator("[data-records-list] .records-row");
    await expect(rows).toHaveCount(1);
    await expect(page.locator("[data-records-count]")).toHaveText("1");
    const dna = (await rows.first().locator(".records-row__dna").textContent())?.trim() ?? "";

    // Drive the record back: it loads into Test Drive as the new draft.
    await rows.first().locator("[data-drive-record]").click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-dna-input]")).toHaveValue(dna);
    await expect(page.locator('[data-barn-pill="drive"]')).toHaveAttribute("aria-pressed", "true");
  });


  test("@smoke adjusts settings and transfers save strings across a reload", async ({
    page,
  }) => {
    await page.locator("[data-open-settings]").click();
    await expect(page.locator("[data-settings-overlay]")).toBeVisible();

    // Master volume + ambience off, driven like a player would.
    await page.locator("[data-settings-master]").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "20";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator('[data-settings-ambient="0"]').click();
    await expect(page.locator("[data-ambience-toggle]")).toContainText("Sound: off");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("vroomon:settings") ?? "{}"),
    );
    expect(stored.masterVolume).toBeCloseTo(0.2, 5);
    expect(stored.ambienceVolume).toBe(0);

    // World export/import round trip with a distinctive marker.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, rancherName: "Nyx" });
    });
    // The export comes from the renderer's world copy — rehydrate it from
    // storage first.
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await page.locator("[data-open-settings]").click();
    await page.locator("[data-export-world]").click();
    const transfer = await page.locator("[data-save-transfer]").inputValue();
    expect(transfer.length).toBeGreaterThan(10);
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, rancherName: "" });
    });
    await page.locator("[data-save-transfer]").fill(transfer);
    await page.locator("[data-import-world]").click();
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(async () => (await window.vroomon.loadWorldState()).rancherName),
    ).toBe("Nyx");

    // Run state export/import round trip too.
    await page.evaluate(async () => {
      const run = await window.vroomon.loadRunState();
      await window.vroomon.saveRunState({ ...run, runId: "transfer-me", generation: 41 });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await openPocketRanch(page, "drive");
    await page.waitForTimeout(300);
    await page.keyboard.press("l"); // load the saved run into the session
    await page.waitForTimeout(600);
    await page.locator("[data-open-settings]").click();
    await page.locator("[data-export-run]").click();
    const runTransfer = await page.locator("[data-save-transfer]").inputValue();
    await page.locator("[data-save-transfer]").fill(runTransfer);
    await page.locator("[data-import-run]").click();
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(async () => (await window.vroomon.loadRunState()).runId),
    ).toBe("transfer-me");

    await page.locator("[data-settings-close]").click();
    await expect(page.locator("[data-settings-overlay]")).toBeHidden();
  });


  test("the NPCs teach the loop — Axle breeds champions, Wanda runs the store", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    // Enter town; the townspeople keep teaching in-fiction (no chrome ever
    // spells out the loop).
    await expectModeState(page, "world");
    await expect(page.locator(".menu-howto")).toHaveCount(0);
    await expect(page.locator('[data-onboard="evolution"]')).toHaveCount(0);

    // Axle teaches breeding through the story.
    for (const dir of ["up", "up", "up", "up", "left", "left"]) {
      await page.locator(`[data-dpad="${dir}"]`).click();
      await page.waitForTimeout(300);
    }
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    await page.keyboard.press("z"); // intro beat
    await page.waitForTimeout(400);
    await page.locator("[data-dialogue-option]").nth(1).click(); // "How do I breed a champion?"
    await page.waitForTimeout(500);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("paddock");

    // Wanda teaches the Ranch store + credits. Position the world state
    // right by her shop (she stands at 11,3) and re-enter so the scene is
    // deterministic for both platforms.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        playerX: 10,
        playerY: 3,
        playerFacing: "right",
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await page.waitForTimeout(700);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("Ranch fitters");
    await page.locator("[data-dialogue-option]").first().click(); // "What should I buy first?"
    await page.waitForTimeout(400);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("Pasture first");
  });

  test("@smoke ranches with feed — breeding costs, releasing pays back, grain restocks", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(500);
    // Zero feed: breeding is refused, the cull still frees feed.
    await page.evaluate(async () => {
      const run =
        (await window.vroomon.loadRunState()) ??
        window.vroomon.createEmptyRunState("evolution");
      await window.vroomon.saveRunState({ ...run, feed: 0, wallet: 400 });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await openPocketRanch(page, "herd");
    await page.waitForTimeout(400);
    await page.keyboard.press("l"); // load the zero-feed run
    await page.waitForTimeout(600);
    await page.locator("[data-run-generation]").dispatchEvent("click");
    await expect(page.locator("[data-status-message]")).toContainText("Out of feed");

    // Buy grain, then breed once: feed 0 + 6 - 1 = 5.
    await page.locator("[data-open-ranch]").dispatchEvent("click");
    await page.locator("[data-buy-feed]").dispatchEvent("click");
    await page.waitForTimeout(400);
    await page.locator("[data-close-ranch]").click();
    await page.waitForTimeout(300);
    await page.locator("[data-run-generation]").dispatchEvent("click");
    await expect(page.locator("[data-status-message]")).toContainText("mpleted generation");
    await page.keyboard.press("s");
    await page.waitForTimeout(400);
    const feedAfter = await page.evaluate(async () => (await window.vroomon.loadRunState()).feed);
    expect(feedAfter).toBe(5);

    // Release the selected: +1 feed, herd shrinks by one.
    const sizeBefore = await page.evaluate(async () => (await window.vroomon.loadRunState()).population.length);
    await page.locator("[data-select-vehicle]").first().dispatchEvent("click");
    await page.waitForTimeout(250);
    await page.locator("[data-release-selected]").dispatchEvent("click");
    await page.waitForTimeout(400);
    const released = await page.evaluate(async () => {
      const run = await window.vroomon.loadRunState();
      return { feed: run.feed, size: run.population.length };
    });
    expect(released.feed).toBe(6);
    expect(released.size).toBe(sizeBefore - 1);

    // Cull to the top ten: every culled vroomon repays a feed.
    await page.locator("[data-cull-slow]").dispatchEvent("click");
    await page.waitForTimeout(400);
    const culled = await page.evaluate(async () => {
      const run = await window.vroomon.loadRunState();
      return { feed: run.feed, size: run.population.length };
    });
    expect(culled.size).toBeLessThanOrEqual(10);
    expect(culled.size).toBeGreaterThanOrEqual(1);
  });

});


/** Walk from the title screen into the overworld (CONTINUE when a road exists). */
async function enterWorld(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-menu-action="continue"]').click();
  await page.waitForTimeout(500);
}

/** Open (or refocus) the Pocket Ranch carrier hub on a scene. */
async function openPocketRanch(
  page: import("@playwright/test").Page,
  scene: "herd" | "drive" | "barn" = "herd",
): Promise<void> {
  if (!(await page.locator("[data-barn-overlay]").isVisible())) {
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(350);
  }
  const pill = page.locator(`[data-barn-pill="${scene}"]`);
  if ((await pill.getAttribute("aria-pressed")) !== "true") {
    await pill.click();
    await page.waitForTimeout(350);
  }
}

/** Leave the hub back to the overworld. */
async function closePocketRanch(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("[data-barn-close]").click();
  await page.waitForTimeout(350);
}

/** Seed a rancher and step into the overworld in one go. */
async function seedAndEnterWorld(page: import("@playwright/test").Page): Promise<void> {
  await seedRancher(page);
  await enterWorld(page);
}

async function seedRancher(
  page: import("@playwright/test").Page,
): Promise<void> {
  // Give the session a branded rancher so the world tab skips the opening
  // story — the story itself has its own dedicated test.
  await page.evaluate(async () => {
    const world = await window.vroomon.loadWorldState();
    await window.vroomon.saveWorldState({
      ...world,
      version: 1,
      lastSavedAt: new Date().toISOString(),
      rancherName: "E2E",
      rancherCap: "rust",
    });
  });
  await page.reload();
  await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
}


async function expectModeState(
  page: import("@playwright/test").Page,
  activeMode: ModeId,
): Promise<void> {
  const hub = page.locator("[data-barn-overlay]");

  if (activeMode === "menu") {
    await expect(page.locator("[data-viewport-menu-overlay]")).toBeVisible();
    await expect(hub).toBeHidden();
    return;
  }

  if (activeMode === "world") {
    await expect(hub).toBeHidden();
    await expect(page.locator("[data-overworld-canvas]")).toBeVisible();
    return;
  }

  // Evolution and Test Drive now live inside the Pocket Ranch hub as the
  // herd-bench and paddock scenes.
  const scene = activeMode === "test-drive" ? "drive" : "herd";
  await expect(hub).toBeVisible();
  await expect(page.locator(`[data-barn-pill="${scene}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function readJson<T>(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<T> {
  const text = await page.locator(selector).textContent();

  if (!text) {
    throw new Error(`Expected JSON content in ${selector}.`);
  }

  return JSON.parse(text) as T;
}
