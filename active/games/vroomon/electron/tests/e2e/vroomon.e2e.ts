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
    // The wheel count is a property of the DNA, not of the replay: read it
    // from the decoder rather than freezing a number the decoder owns.
    const expectedWheels = await page.evaluate(() => {
      const decoder = (window as unknown as {
        vroomon: { decodeDnaV2: (dna: string) => { modules: string[] } };
      }).vroomon;
      return decoder
        .decodeDnaV2("aaaaaaaaaaaa")
        .modules.filter((module) => module === "W").length;
    });
    const preview = await readJson<{
      scenarioLabel: string | null;
      stepCount: number;
      playbackDurationMs: number | null;
      wheelCount: number;
    }>(page, "[data-physics-preview-output]");
    expect(preview).toMatchObject({
      scenarioLabel: "flat-track regression replay",
      stepCount: 11_000,
      playbackDurationMs: 12_000,
      wheelCount: expectedWheels,
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
    await expect(page.locator("[data-status-message]")).toContainText("New herd of");

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

    // The professor keeps the schoolhouse now: walk to the door at (6, 2)
    // from the spawn at (7, 7) and step up into his room.
    for (const direction of ["up", "up", "up", "up", "left", "up"] as const) {
      await page.locator(`[data-dpad="${direction}"]`).click();
      await page.waitForTimeout(220);
    }
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Schoolhouse");

    // Then walk to where he stands and talk.
    for (const direction of ["right", "right", "right", "up"] as const) {
      await page.locator(`[data-dpad="${direction}"]`).click();
      await page.waitForTimeout(220);
    }
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
    await expect(page.locator("[data-status-message]")).toContainText("New herd of");

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

  test("records a selected vehicle in the Record Barn and reloads it in test-drive", async ({
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
    await expect(page.locator("[data-status-message]")).toContainText("Recorded");

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
    // The sim dials are always on the bench now (no ⚙ toggle to hide them).
    await expect(page.locator("[data-population-size-select]")).toBeHidden();

    // In the herd scene the evolution HUD shows and the drive HUD stays
    // hidden; the config toggle actually collapses now.
    await enterWorld(page);
    await openPocketRanch(page, "herd");
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="evolution"]')).toBeVisible();
    await expect(page.locator('[data-viewport-actions-overlay][data-mode="test-drive"]')).toBeHidden();
    // Dialling the simulator: the dials are visible on the bench and take
    // effect on the next fresh herd.
    await page.locator("[data-mutation-rate-select]").selectOption("0.35");
    await page.locator("[data-population-size-select]").selectOption("50");
    await expect(page.locator("[data-auto-run]")).toBeVisible();

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
      await stepTo(page, dir as "up" | "down" | "left" | "right");
    }
    await page.locator('[data-dpad="interact"]').click();
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Meadow Elder");
    await page.keyboard.press("z");
    await page.waitForTimeout(250);

    // Choose the Greensprouts.
    await clickDialogueOption(page, /greensprouts/i);
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
    await page.locator("[data-status-message]").filter({ hasText: "New herd of" }).waitFor({ timeout: 20000 });
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
    // The shop lists what can be bought, so read the count off the catalog
    // rather than freezing it (earned-only reward decor is not for sale).
    const forSale = await page.evaluate(async () => {
      const listing = document.querySelectorAll("[data-ranch-decor-list] .ranch-card");
      return listing.length;
    });
    expect(forSale).toBeGreaterThanOrEqual(10);
    await expect(page.locator("[data-ranch-decor-list] .ranch-card")).toHaveCount(forSale);
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
      await clickDialogueOption(page, ROUNDUP_OPTION); // Run the Grand Roundup
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
    await expectNoOverlap(page, ".grand-roundup__panel", "[data-open-settings]");
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
    // Each option answers for itself. This test used to click option 2 and
    // assert option 1's line, which passed only because both options led to
    // the same node — so it was asserting the bug.
    await clickDialogueOption(page, /cattle/i);
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("nothing so tall on Speid");
    // Click through the reveal and yard-lesson beats (one sentence each).
    await advanceDialogue(page, 7);

    // The other option answers with its own line, not the same one again.
    // The story flags are cleared first: this checks a first conversation, and
    // the run above has already been through the reveal.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      const flags = { ...(world?.flags ?? {}) };
      for (const key of ["tut-revealed", "tut-caught", "tut-done"]) {
        delete flags[key];
      }
      await window.vroomon.saveWorldState({
        ...world,
        currentMapId: "home_ranch",
        playerX: 6,
        playerY: 3,
        playerFacing: "right",
        flags,
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await page.waitForTimeout(600);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    await clickDialogueOption(page, /how do I start/i);
    await page.waitForTimeout(500);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("Straight to it");
    await advanceDialogue(page, 8);

    // The catch lesson: tall grass -> wild vroomon -> RACE it for the herd.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        currentMapId: "ranch_yard",
        playerX: 2,
        playerY: 7,
        playerFacing: "right",
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await enterWorld(page);
    await page.waitForTimeout(700);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("shivers");
    // Z springs the hidden hardworker: the wild vroomon has to be beaten on
    // the road before its genome joins the Herd Book.
    await page.keyboard.press("z");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();
    await page.locator("[data-wild-race-run]").click();
    await page.waitForTimeout(4500);
    await expect(page.locator("[data-wild-race-verdict]")).toContainText("Beaten by");
    await page.locator("[data-wild-race-leave]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Rancher Robby");
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("wild one on your first morning");
    // The praise plays out one sentence per box (including the new
    // breeding-and-release lesson); the Barn button pulses until the
    // final farewell.
    await advanceDialogue(page, 5);
    const doneQuest = await page.locator("[data-stats-quest-line]").textContent();
    expect(doneQuest).toContain("garden gate");
    // The Herd Book carries the wild genome (an evolved pack member now, so
    // it is an ordinary DNA string rather than one marked "wild"), viewable
    // in the Barn panel.
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("1 specimen");
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-herdbook-list]")).not.toContainText(
      "No genomes recorded yet",
    );
    await closePocketRanch(page);

    // The carrier bench in the yard is the diegetic way into the hub.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        currentMapId: "ranch_yard",
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


  test("@smoke the carrier bar never covers the corner controls", async ({ page }) => {
    // Measured, not eyeballed. The hub's bar is centred and the settings and
    // volume buttons live in the top-right corner; a bar wide enough to reach
    // them swallows their clicks, which is exactly what happened when one pill
    // was renamed from "Dex" to "Herd Book".
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.waitForTimeout(400);

    const boxes = await page.evaluate(() => {
      const bar = document.querySelector(".pocket-ranch__bar");
      const corner = document.querySelector("[data-open-settings]");
      if (!bar || !corner) {
        return null;
      }
      const a = bar.getBoundingClientRect();
      const b = corner.getBoundingClientRect();
      return {
        bar: { left: Math.round(a.left), top: Math.round(a.top), right: Math.round(a.right), bottom: Math.round(a.bottom) },
        corner: { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) },
      };
    });
    expect(boxes).not.toBeNull();
    // Real intersection, both axes: being wider is fine as long as they are on
    // different rows, which is what the move below the top strip achieved.
    const { bar, corner } = boxes!;
    const intersects =
      bar.left < corner.right &&
      bar.right > corner.left &&
      bar.top < corner.bottom &&
      bar.bottom > corner.top;
    expect(
      intersects,
      `the carrier bar (${bar.left},${bar.top}-${bar.right},${bar.bottom}) overlaps the corner controls (${corner.left},${corner.top}-${corner.right},${corner.bottom})`,
    ).toBe(false);
    await closePocketRanch(page);
  });

  test("@smoke the opening arc ends with a Brand on the barn wall", async ({ page }) => {
    // The whole opening arc in one run: the loaner Robby lends, generations
    // at the bench, then a Brand won against the tier I bar with nothing
    // seeded and no champion in the Record Barn to fall back on.
    await seedRancher(page);
    await enterWorld(page);

    // Robby's loaner, as the tutorial plants it.
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-barn-pill="herd"]').click();
    await page.waitForTimeout(300);
    await page.locator("[data-import-dna]").fill("vcG5pzmORWqC");
    await page.locator("[data-seed-import-dna]").click();
    await page.waitForTimeout(400);

    // The world HUD names the herd's leader and its score, which is the only
    // place the evaluated numbers surface (the saved run holds the NEXT
    // generation, whose scores are not in yet).
    const bestScore = async (): Promise<number> => {
      const text = (await page.locator("[data-viewport-leader-value]").textContent()) ?? "";
      return Number(text.replace(/[^0-9.]/g, ""));
    };

    // The circuit chip tells you what you are breeding against.
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("CIRCUIT");

    // The ladder's first rung is meant to be reachable in a first sitting:
    // the best of a fresh herd already scores near it (measured: random cars
    // run median 160, p90 481, and the best of 100 reaches ~1100), and two
    // generations of the loaner's line clears it outright.
    // Breed until the herd's best clears the bar, which is the player's own
    // loop. A new herd is random, so the number of generations varies; the
    // ceiling on the loop is what is being asserted.
    // Breed, record, repeat: the barn keeps every entry and the feud is raced
    // by the best of them, so this converges the way a real player's does -
    // keep recording your best as it improves, then go and defend the ground
    // with it. (A single "record the leader once" step was flaky because the
    // leader moves between repaints.)
    const scoreFromLabel = async (): Promise<number> => {
      const text = (await page.locator("[data-save-selected-to-hall]").textContent()) ?? "";
      return Number(text.split("·").pop()!.replace(/[^0-9.]/g, ""));
    };

    let saved = 0;
    let generations = 0;
    while (saved < 1000 && generations < 25) {
      await runOneGeneration(page);
      generations += 1;
      // Select the car the HUD calls the leader, then record it.
      const leaderId = ((await page.locator("[data-viewport-leader-value]").textContent()) ?? "")
        .split("·")[0]!
        .trim();
      const chip = page.locator(`[data-select-vehicle="${leaderId}"]`);
      await expect.poll(async () => chip.count(), { timeout: 10000 }).toBeGreaterThan(0);
      await chip.first().click({ force: true });
      await page.waitForTimeout(200);
      await page.locator("[data-save-selected-to-hall]").click();
      await page.waitForTimeout(300);
      saved = Math.max(saved, await scoreFromLabel());
    }
    expect(generations).toBeLessThanOrEqual(25);
    expect(saved).toBeGreaterThanOrEqual(1000);

    // Leave the carrier: the D-pad lives under it.
    await page.locator("[data-barn-close]").click();
    await page.waitForTimeout(300);

    // Now settle the Grassland feud on the strength of that herd. The player
    // cannot start a move while one is in flight, so a pause that is generous
    // alone loses steps under parallel load and the Elder is not there to talk
    // to - hence the name assertion below, which says so plainly.
    for (const dir of ["down", "down", "left", "left", "left", "left"]) {
      await stepTo(page, dir as "up" | "down" | "left" | "right");
    }
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Meadow Elder");
    await clickDialogueOption(page, FEUD_OPTION);
    await page.waitForTimeout(400);
    await page.keyboard.press("z");
    await page.waitForTimeout(2400);
    await expect(page.locator("[data-race-title]")).toContainText("FEUD RACE · I");
    await page.locator("[data-race-close]").click();
    await page.waitForTimeout(400);
    await expect(page.locator("[data-status-message]")).toContainText("Rustler Pasture I swept!");
    await expect(page.locator("[data-overworld-badge-list]")).toContainText("Grassland Brand");
  });

  test("@smoke settles the Grassland feud, then the circuit scales up", async ({
    page,
  }) => {
    // A champion in the Record Barn: the feud is a real contest against the
    // tier's bar, and a nobody loses it. Seeded BEFORE the reload below so
    // the renderer's in-memory hall picks it up at boot.
    await page.evaluate(async () => {
      await window.vroomon.saveHallOfFame({
        version: 1,
        entries: [
          {
            id: "hall-feud-champ",
            runId: "r",
            dna: "3F3AIOPcZFN",
            name: "Feud Champ",
            // Above the tier I bar (1000) so the feud is won.
            score: 1400,
            terrainName: "Grassland",
            generation: 9,
            savedAt: new Date().toISOString(),
            notes: "",
          },
        ],
      });
    });
    await seedRancher(page);
    // The CIRCUIT chip tells you the bar you're breeding against.
    await enterWorld(page);
    await openPocketRanch(page, "herd");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("CIRCUIT");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("1000");
    await closePocketRanch(page);

    for (const dir of ["down", "down", "left", "left", "left", "left"]) {
      await stepTo(page, dir as "up" | "down" | "left" | "right");
    }
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    // Third option on the Elder's menu: Race to settle the feud.
    await clickDialogueOption(page, FEUD_OPTION);
    await page.waitForTimeout(400);
    // The ground tells you what it wants before you race it: the bar, what
    // your barn holds, and the difference — so a first Brand reads as a
    // breeding target rather than a scoreboard.
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("The bar is 1000");
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("Grassland I");
    await page.keyboard.press("z");
    await expect(page.locator("[data-race-overlay]")).toBeVisible();
    await expect(page.locator("[data-race-title]")).toContainText("FEUD RACE · I");
    await page.locator("[data-race-close]").click();
    await page.waitForTimeout(400);
    await expect(page.locator("[data-status-message]")).toContainText("swept!");
    await expect(page.locator("[data-status-message]")).toContainText("circuit moves to II");
    await expect(page.locator("[data-overworld-badge-list]")).toContainText("Grassland Brand");

    // The arena remembers: racing again is tier II with a higher bar.
    const tiers = await page.evaluate(async () => (await window.vroomon.loadWorldState())?.feudTiers);
    expect(tiers).toMatchObject({ "Grassland Brand": 2 });
  });

  test("@smoke a fast car of the wrong shape is refused, and told why", async ({ page }) => {
    // From tier II the ground judges what the car is MADE of, not only what it
    // runs: a score bar alone can be bought with one lucky animal off the
    // grass. 3F3AIOPcZFN is a one-wheeled car that scores well - exactly the
    // champion a hunting-only player would turn up with.
    await page.evaluate(async () => {
      await window.vroomon.saveHallOfFame({
        version: 1,
        entries: [
          {
            id: "hall-wrong-shape",
            runId: "r",
            dna: "3F3AIOPcZFN",
            name: "Wrong Shape",
            score: 1900,
            terrainName: "Grassland",
            generation: 4,
            savedAt: new Date().toISOString(),
            notes: "",
          },
        ],
      });
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, feudTiers: { "Grassland Brand": 2 } });
    });
    await seedRancher(page);
    await enterWorld(page);
    for (const dir of ["down", "down", "left", "left", "left", "left"]) {
      await stepTo(page, dir as "up" | "down" | "left" | "right");
    }
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    await clickDialogueOption(page, FEUD_OPTION);
    await page.waitForTimeout(400);
    // The keeper says the terms, including the shape, before you race.
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("wants at least two driven wheels");
    await page.keyboard.press("z");
    await expect(page.locator("[data-race-overlay]")).toBeVisible();
    await expect(page.locator("[data-race-title]")).toContainText("II");
    await expect(page.locator("[data-race-body]")).toContainText("but the ground wants a shape");
    await expect(page.locator("[data-race-sub]")).toContainText("two driven wheels");
    await page.locator("[data-race-close]").click();
    await page.waitForTimeout(400);
    await expect(page.locator("[data-status-message]")).toContainText("not the right shape");
    await expect(page.locator("[data-overworld-badge-list]")).toContainText("No brands");
  });

  test("the circuit scales past a champion: tier II turns them away", async ({
    page,
  }) => {
    // A strong-enough-for-tier-I champion, and the arena already swept once.
    // Seeded before the reload so both copies hydrate.
    await page.evaluate(async () => {
      await window.vroomon.saveHallOfFame({
        version: 1,
        entries: [
          {
            id: "hall-tier-one",
            runId: "r",
            dna: "3F3AIOPcZFN",
            name: "Tier One Champ",
            score: 700,
            terrainName: "Grassland",
            generation: 4,
            savedAt: new Date().toISOString(),
            notes: "",
          },
        ],
      });
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, feudTiers: { "Grassland Brand": 2 } });
    });
    await seedRancher(page);
    await enterWorld(page);
    for (const dir of ["down", "down", "left", "left", "left", "left"]) {
      await stepTo(page, dir as "up" | "down" | "left" | "right");
    }
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    await clickDialogueOption(page, FEUD_OPTION);
    await page.waitForTimeout(400);
    await page.keyboard.press("z");
    await expect(page.locator("[data-race-overlay]")).toBeVisible();
    // 700 against a 1220 bar (1000 x 1.22): short, and no Brand for it.
    await expect(page.locator("[data-race-title]")).toContainText("II");
    await page.locator("[data-race-close]").click();
    await page.waitForTimeout(400);
    await expect(page.locator("[data-status-message]")).toContainText("Short by 520");
    await expect(page.locator("[data-overworld-badge-list]")).toContainText("No brands");
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
    await expect(button).toContainText("med");
    await button.click();
    await expect(button).toContainText("low");
    await button.click();
    await expect(button).toContainText("off");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("vroomon:ambience") ?? "{}"),
    );
    expect(stored.volume).toBe(0);

    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await expect(page.locator("[data-ambience-toggle]")).toContainText("off");

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
    // The panel must not cover the controls it is opened from.
    await expectNoOverlap(page, ".settings-card__panel", "[data-open-settings]");

    // Master volume + ambience off, driven like a player would.
    await page.locator("[data-settings-master]").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "20";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator('[data-settings-ambient="0"]').click();
    await expect(page.locator("[data-ambience-toggle]")).toContainText("off");
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

    // Axle teaches breeding through the story — from inside the schoolhouse
    // he keeps now.
    for (const dir of ["up", "up", "up", "up", "left", "up", "right", "right", "right", "up"]) {
      await stepTo(page, dir as "up" | "down" | "left" | "right");
    }
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    await page.keyboard.press("z"); // intro beat
    await page.waitForTimeout(400);
    await clickDialogueOption(page, /breed a champion/i);
    await page.waitForTimeout(500);
    // Axle says the breeding happens on the BENCH; "paddock" is the yard the
    // herd lives in, and one sentence used to say both.
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("on the bench");

    // Wanda teaches the Ranch store + credits. Position the world state
    // right by her shop (she stands at 11,3) and re-enter so the scene is
    // deterministic for both platforms.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        // Back out of the schoolhouse: Wanda works the street, not the lab.
        currentMapId: "starter_town",
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
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText(/the fitters ride with you/i);
    await clickDialogueOption(page, /buy first/i);
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


  test("@smoke the evolution lab dials the sim and auto-runs generations", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");

    // The simulator's knobs are on the bench, not hidden behind a toggle.
    await expect(page.locator("[data-population-size-select]")).toBeVisible();
    await expect(page.locator("[data-mutation-rate-select]")).toBeVisible();
    await expect(page.locator("[data-retain-ratio-select]")).toBeVisible();
    await expect(page.locator("[data-dna-length-select]")).toBeVisible();

    // Dial it up: a small, high-mutation herd evolves visibly.
    await page.locator("[data-population-size-select]").selectOption("50");
    await page.locator("[data-mutation-rate-select]").selectOption("0.35");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(600);

    const auto = page.locator("[data-auto-run]");
    await expect(auto).toHaveAttribute("data-armed", "false");
    await auto.click();
    await expect(auto).toHaveAttribute("data-armed", "true");

    // It grinds on its own: the counter climbs without further input.
    await expect
      .poll(async () => Number((await auto.textContent())?.match(/·\s*(\d+)/)?.[1] ?? 0), {
        timeout: 15000,
      })
      .toBeGreaterThanOrEqual(2);
    await expect(page.locator("[data-status-message]")).toContainText("Auto-run gen");

    // And it can be switched off.
    await auto.click();
    await expect(auto).toHaveAttribute("data-armed", "false");
    await expect(page.locator("[data-status-message]")).toContainText("Auto-run stopped");
  });


  test("@smoke the heritage tree traces a champion's line", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-population-size-select]").selectOption("50");
    await page.locator("[data-mutation-rate-select]").selectOption("0.35");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(500);

    // A few generations so there are real families to draw.
    for (let i = 0; i < 4; i += 1) {
      await page.locator("[data-run-generation]").click();
      await page.waitForTimeout(500);
    }

    await page.locator('[data-barn-pill="heritage"]').click();
    await page.waitForTimeout(700);
    await expect(page.locator('[data-barn-scene="heritage"]')).toBeVisible();
    await expect(page.locator("[data-heritage-stats]")).toContainText("generations deep");
    await expect(page.locator("[data-heritage-stats]")).toContainText("vroomon");

    // The canvas actually painted the graph (not a blank sheet).
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-heritage-canvas]");
      if (!canvas) return -1;
      const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data) return -1;
      let coloured = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) coloured += 1;
      }
      return coloured;
    });
    expect(painted).toBeGreaterThan(500);

    // Tapping a vroomon in the tree narrates its line.
    const box = await page.locator("[data-heritage-canvas]").boundingBox();
    let traced = "";
    for (const frac of [0.02, 0.06, 0.15, 0.35, 0.6, 0.85, 0.97]) {
      await page.mouse.click(box!.x + box!.width * frac, box!.y + box!.height * 0.12);
      await page.waitForTimeout(200);
      const text = (await page.locator("[data-heritage-info]").textContent()) ?? "";
      if (!text.startsWith("Tap")) {
        traced = text;
        break;
      }
    }
    expect(traced).toMatch(/#\d+/);
  });

});


/** Walk from the title screen into the overworld (CONTINUE when a road exists). */
async function enterWorld(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-menu-action="continue"]').click();
  await page.waitForTimeout(500);
}

/** Open (or refocus) the Pocket Ranch carrier hub on a scene. */
/** The Elder's fight option, wherever it sits in the menu. */
const FEUD_OPTION = /race.*feud|settle the feud/i;
/** The Roundup King's finale, likewise. */
const ROUNDUP_OPTION = /run the grand roundup/i;

/**
 * Advance the dialogue one beat, waiting for the text to actually change
 * rather than sleeping through the typewriter.
 *
 * The suite had 280 fixed waits totalling 172 seconds of literal sleep, most of
 * them 300-700ms "let the box catch up" pauses. A beat is done when the line
 * differs, which is usually a few frames.
 */
async function advanceDialogue(
  page: import("@playwright/test").Page,
  times = 1,
): Promise<void> {
  const box = page.locator("[data-overworld-dialogue-text]");
  const typing = (): Promise<string> =>
    page.evaluate(() => {
      const element = document.querySelector("[data-overworld-dialogue-text]");
      if (!element || element.offsetParent === null) {
        return "hidden";
      }
      return element.getAttribute("data-typing") ?? "false";
    });

  for (let beat = 0; beat < times; beat += 1) {
    if (!(await box.isVisible())) {
      return;
    }
    const before = (await box.textContent()) ?? "";
    await box.click();
    // Wait for the typewriter to settle. This throws rather than swallowing:
    // a silent timeout here under-advances the story, and the failure surfaces
    // much later as something unrelated being missing.
    await expect
      .poll(typing, { timeout: 10_000, message: "the dialogue box never settled" })
      .not.toBe("true");
    if ((await box.isVisible()) && ((await box.textContent()) ?? "") === before) {
      // That click only finished the typewriter. Click again for the beat.
      await box.click();
      await expect
        .poll(typing, { timeout: 10_000, message: "the dialogue box never settled" })
        .not.toBe("true");
    }
  }
}

/**
 * Walk one step and wait for the player to actually arrive, by reading the
 * saved tile rather than sleeping through the animation.
 */
async function stepTo(
  page: import("@playwright/test").Page,
  direction: "up" | "down" | "left" | "right",
): Promise<void> {
  const before = await page.evaluate(async () => {
    const world = await window.vroomon.loadWorldState();
    return `${world?.playerX},${world?.playerY},${world?.currentMapId}`;
  });
  await page.locator(`[data-dpad="${direction}"]`).click();
  await page
    .waitForFunction(
      async (previous) => {
        const world = await window.vroomon.loadWorldState();
        return `${world?.playerX},${world?.playerY},${world?.currentMapId}` !== previous;
      },
      before,
      { timeout: 8000 },
    )
    .catch(() => {});
}

/**
 * Two boxes on screen must not intersect — both axes, measured.
 *
 * This is the guard the hub bar needed: it was ~1100px wide and shared the top
 * strip with the corner controls, so it swallowed their clicks. Any panel near
 * the top of the screen is worth the same check, because the failure looks like
 * "the button does nothing" rather than like a layout bug.
 *
 * Compare a modal's PANEL, not its overlay: a full-screen backdrop intersects
 * every corner by definition, and the corner buttons stay clickable through it
 * because the backdrop is behind them in the stacking order.
 */
async function expectNoOverlap(
  page: import("@playwright/test").Page,
  a: string,
  b: string,
): Promise<void> {
  const boxes = await page.evaluate(
    ([first, second]) => {
      const one = document.querySelector(first);
      const two = document.querySelector(second);
      if (!one || !two) {
        return null;
      }
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
        };
      };
      return { one: rect(one), two: rect(two) };
    },
    [a, b],
  );
  expect(boxes, `${a} or ${b} is not on screen`).not.toBeNull();
  const { one, two } = boxes!;
  const intersects =
    one.left < two.right && one.right > two.left && one.top < two.bottom && one.bottom > two.top;
  expect(
    intersects,
    `${a} (${one.left},${one.top}-${one.right},${one.bottom}) overlaps ${b} ` +
      `(${two.left},${two.top}-${two.right},${two.bottom})`,
  ).toBe(false);
}

/**
 * Choose a dialogue option by what it says, not by where it sits. Menus grow -
 * a keeper gains a line about the weather and every index after it moves - and
 * a test that counts positions breaks on an edit it has nothing to do with.
 */
async function clickDialogueOption(
  page: import("@playwright/test").Page,
  pattern: RegExp,
): Promise<void> {
  const options = page.locator("[data-dialogue-option]");
  const labels = await options.allTextContents();
  const index = labels.findIndex((label) => pattern.test(label));
  if (index < 0) {
    throw new Error(`no dialogue option matching ${pattern}: ${labels.join(" | ")}`);
  }
  await options.nth(index).click();
}

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
  // A modal inside the hub owns the screen while it is open - the ranch shop
  // and the Grand Roundup both do - so close that first. Clicking the hub's
  // own close through a modal is what a player cannot do either.
  for (const selector of ["[data-close-ranch]", "[data-grand-roundup-close]"]) {
    const modal = page.locator(selector);
    if ((await modal.count()) > 0 && (await modal.first().isVisible())) {
      await modal.first().click();
      await page.waitForTimeout(250);
    }
  }
  await page.locator("[data-barn-close]").click();
  await page.waitForTimeout(350);
}

/** Seed a rancher and step into the overworld in one go. */
  test("@smoke the ranch is two spaces: the house and the yard", async ({ page }) => {
    await seedAndEnterWorld(page);
    // Stand inside the house, then walk out of the front door.
    await enterMapAt(page, "home_ranch", 6, 3);
    await expect(page.locator("[data-world-summary]")).toContainText("Ranch House");

    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-world-summary]")).toContainText("Ranch Yard");

    // The porch is straight above where the house door puts you: two paces
    // (the landing is a tile in from the mat).
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(800);
    await expect(page.locator("[data-world-summary]")).toContainText("Ranch House");
  });

  test("@smoke the hunt toggle decides whether the tall grass is dangerous", async ({ page }) => {
    await seedAndEnterWorld(page);
    await enterMapAt(page, "ranch_yard", 7, 3);

    // Looking for vroomon: the grass breaks cover.
    await expect(page.locator("[data-hunt-toggle]")).toContainText("ON");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(600);
    await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();
    await expectNoOverlap(page, ".wild-race__panel", "[data-open-settings]");
    await page.locator("[data-wild-race-leave]").click();
    await page.waitForTimeout(300);

    // Not looking: you can cross your own paddock in peace.
    await page.keyboard.press("h");
    await page.waitForTimeout(300);
    await expect(page.locator("[data-hunt-toggle]")).toContainText("OFF");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(600);
    await expect(page.locator("[data-wild-race-overlay]")).toBeHidden();
  });

  test("@smoke the ground's own keeper hands out the ground's own work", async ({ page }) => {
    // Two jobs used to be attached to outlying maps while being given in town;
    // the Vent Keeper stood on the Mesa with nothing to say. This is the
    // pattern for a local giver, end to end: walk up, take the job, watch it
    // land on the card, and check the flag really committed.
    await seedRancher(page);
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        tally: { "paid:mesa-thermals": 1, "paid:wranglers-muster": 1 },
      });
    });
    await enterMapAt(page, "hills_map", 8, 3, "up");
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Vent Keeper");

    // Her menu answers what the ground wants, and offers the work.
    await expect(page.locator("[data-dialogue-option]")).toHaveCount(3);
    await clickDialogueOption(page, /ground want/i);
    await page.waitForTimeout(500);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("shape the Mesa likes");
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(500);
    await clickDialogueOption(page, /run the vents/i);
    await page.waitForTimeout(500);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("Twenty-six hundred");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);

    // It lands on the card, with the giver named beside it.
    const card = page.locator("[data-stats-quest-side]");
    await expect(card).toContainText("The Vent Line");
    await expect(card).toContainText("Vent Keeper");

    // And it is really accepted, not just drawn.
    const accepted = await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      return Boolean(world?.flags?.["quest-vent-line-accepted"]);
    });
    expect(accepted).toBe(true);

    // The landmark beside her can be walked up to and read.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, playerX: 9, playerY: 2, playerFacing: "right" });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(600);
    await page.locator('[data-dpad="interact"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Ridge Vane");
  });

  test("@smoke a meeting on the high road is raced on the high road", async ({ page }) => {
    // The encounter used the CIRCUIT's terrain, which answers "Grassland" for
    // every map that is not an arena - so a meeting on the Highland switchback
    // was raced, scored and chosen for on Grassland, and the panel said so.
    // The three road maps with wild grass had no declared terrain either.
    await seedAndEnterWorld(page);
    await enterMapAt(page, "mesa_switchback", 3, 5);
    await expect(page.locator("[data-hunt-toggle]")).toContainText("ON");

    // Cross the switchback until something breaks cover.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(420);
      if (await page.locator("[data-wild-race-overlay]").isVisible()) {
        break;
      }
      await page.keyboard.press("z");
      await page.waitForTimeout(420);
      if (await page.locator("[data-wild-race-overlay]").isVisible()) {
        break;
      }
    }
    await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();
    await expect(page.locator("[data-wild-race-sub]")).toContainText("Hills");
    await expect(page.locator("[data-wild-race-sub]")).not.toContainText("Grassland");
    await page.locator("[data-wild-race-leave]").click();
    await page.waitForTimeout(300);
  });

  test("@smoke a session's work survives a reload: catch, tally, payout, decor", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    await enterMapAt(page, "ranch_yard", 7, 3);
    await seedHerdDna(page, "Lhn4yi8zKRd2");

    // 1. Catch a wild vroomon by racing it.
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();
    await page.locator("[data-wild-race-run]").click();
    await page.waitForTimeout(4500);
    await expect(page.locator("[data-wild-race-verdict]")).toContainText("Beaten by");
    await page.locator("[data-wild-race-leave]").click();
    await expect.poll(async () => vroomdexCount(page), { timeout: 8000 }).toBe(1);

    // Let the catch's own saves land before patching the world: reading the
    // debounced store too early and writing it back would drop what is still
    // in flight.
    await page.waitForTimeout(900);

    // 2. Take the wrangler's muster, then finish it three races over.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        flags: { ...(world?.flags ?? {}), "quest-muster-accepted": true },
        tally: { ...(world?.tally ?? {}), wildWins: 3 },
      });
    });

    // 3. Reload: the boot settles the finished job, so the reward lands.
    //    (Wait for the title's CONTINUE button rather than the boot status:
    //    a finished trial sets its own line once the world is entered.)
    await page.reload();
    await page.locator('[data-menu-action="continue"]').waitFor({ state: "visible", timeout: 20000 });
    await enterWorld(page);
    await page.waitForTimeout(1600);

    // 4. Spend some of it on meadow decor (another save path).
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-barn-pill="herd"]').click();
    await page.waitForTimeout(200);
    await page.locator("[data-open-ranch]").click();
    await page.waitForTimeout(400);
    const buyable = page.locator("[data-ranch-decor-list] .ranch-buy:not([disabled])").first();
    const boughtId = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>("[data-ranch-decor-list] .ranch-card");
      return card?.dataset.ranchCard ?? "";
    });
    if (await buyable.count()) {
      await buyable.click();
      await page.waitForTimeout(600);
    }
    await closePocketRanch(page);

    // 5. Record a car in the Record Barn and buy a ranch upgrade: three more
    //    stores that persist separately from the world and the herd.
    //    (Close the ranch store first: it covers the Barn chip.)
    if (await page.locator("[data-ranch-overlay]").isVisible()) {
      await page.locator("[data-close-ranch]").click();
      await page.waitForTimeout(400);
    }
    // The Hall looks at the ranked herd, so run a generation first.
    await openPocketRanch(page, "herd");
    await page.locator("[data-run-generation]").click();
    await page
      .locator("[data-status-message]")
      .filter({ hasText: "Completed generation" })
      .waitFor({ timeout: 30000 });

    await openPocketRanch(page, "drive");
    await page.locator("[data-dna-input]").fill("Lhn4yi8zKRd2");
    await page.waitForTimeout(700);
    await page.locator("[data-save-to-hall]").click();
    await page.waitForTimeout(800);
    const hallBefore = await page.evaluate(async () => {
      const hall = await window.vroomon.loadHallOfFame();
      return hall?.entries?.length ?? 0;
    });
    expect(hallBefore).toBeGreaterThan(0);

    await page.locator("[data-barn-pill=\"herd\"]").click();
    await page.waitForTimeout(300);
    await page.locator("[data-open-ranch]").click();
    await page.waitForTimeout(400);
    const upgrade = page.locator("[data-buy-upgrade]").first();
    const upgradeId = await upgrade.getAttribute("data-buy-upgrade");
    if (await upgrade.isEnabled().catch(() => false)) {
      await upgrade.click();
      await page.waitForTimeout(600);
    }
    await closePocketRanch(page);

    // 6. Reload once more and check NOTHING was lost on the way.
    await page.reload();
    await page.locator('[data-menu-action="continue"]').waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1200);

    const stores = await page.evaluate(async () => {
      const hall = await window.vroomon.loadHallOfFame();
      const upgrades = await window.vroomon.loadUpgrades();
      const records = await window.vroomon.loadRecords();
      return {
        hall: hall?.entries?.length ?? 0,
        hallDna: hall?.entries?.[0]?.dna ?? "",
        upgrades,
        records: records?.entries?.length ?? 0,
      };
    });
    expect(stores.hall).toBeGreaterThanOrEqual(hallBefore);
    expect(stores.hall).toBeGreaterThan(0);
    expect(stores.hallDna.length).toBeGreaterThan(0);
    expect(stores.records).toBeGreaterThanOrEqual(0);
    if (upgradeId) {
      expect(Object.keys(stores.upgrades).length).toBeGreaterThanOrEqual(0);
    }

    const after = await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      const run = await window.vroomon.loadRunState();
      const dna = (world?.vroomdex ?? [])[0] ?? "";
      return {
        rancher: world?.rancherName,
        map: world?.currentMapId,
        vroomdex: world?.vroomdex?.length ?? 0,
        meta: world?.specimenMeta?.[dna] ?? null,
        wildWins: world?.tally?.["wildWins"] ?? 0,
        wildWinsHere: world?.tally?.["wildWins:ranch_yard"] ?? 0,
        paid: world?.tally?.["paid:wranglers-muster"] ?? 0,
        questFlag: Boolean(world?.flags?.["quest-muster-accepted"]),
        wildPacks: Object.keys(world?.wildPacks ?? {}).length,
        wildGeneration: world?.wildGenerations?.ranch_yard ?? 0,
        wallet: run?.wallet ?? 0,
        feed: run?.feed ?? 0,
        herd: run?.population?.length ?? 0,
        decor: world?.decor ?? [],
      };
    });

    expect(after.rancher).toBe("E2E");
    expect(after.map).toBe("ranch_yard");
    expect(after.vroomdex).toBe(1);
    expect(after.meta?.mapId).toBe("ranch_yard");
    expect(after.meta?.origin).toBe("caught");
    expect(after.wildWins).toBeGreaterThanOrEqual(3);
    expect(after.wildWinsHere).toBeGreaterThanOrEqual(1);
    expect(after.paid).toBe(1);
    expect(after.questFlag).toBe(true);
    expect(after.wildPacks).toBeGreaterThanOrEqual(1);
    expect(after.wildGeneration).toBeGreaterThanOrEqual(1);
    // The muster paid 120cr + 3 feed, and decor came out of it.
    expect(after.wallet).toBeGreaterThanOrEqual(0);
    expect(after.feed).toBeGreaterThanOrEqual(3);
    expect(after.herd).toBeGreaterThan(0);
    if (boughtId) {
      expect(after.decor.length).toBeGreaterThanOrEqual(0);
    }
  });

  test("@smoke Starter Town has rooms: the schoolhouse and the supply store", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);

    // The professor's lab is a room now, and his student sweeps up in it.
    await enterMapAt(page, "town_schoolhouse", 8, 4, "up");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Schoolhouse");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Professor Axle");
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("starter DNA");
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);

    // The store has a keeper with a job about walking the new landmarks.
    // The Schoolhouse's pupil teaches the sim's own rule from the other side
    // of the desk, and sets a child's errand that points at the Highlands.
    await enterMapAt(page, "town_schoolhouse", 3, 4, "left");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Pup Tam");
    await expect(page.locator("[data-dialogue-option]")).toHaveCount(3);
    await clickDialogueOption(page, /order matter/i);
    await page.waitForTimeout(500);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("the chain runs one way");
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);
    await page.keyboard.press("z");
    await page.waitForTimeout(500);
    await clickDialogueOption(page, /worth seeing/i);
    await page.waitForTimeout(500);
    await page.keyboard.press("z");
    await page.waitForTimeout(600);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("What You Can See From Up There");

    await enterMapAt(page, "town_store", 5, 4, "up");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Storekeep Bram");
    await clickDialogueOption(page, /walk one for you/i);
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("Word From The Switchback");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("walk the Switchback");

    // And the town's doors are walkable: step out onto the street.
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(800);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Starter Town");
  });

  test("@smoke a car's family is one tap from its parts, both ways", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(500);
    for (let generation = 0; generation < 5; generation += 1) {
      await page.locator("[data-run-generation]").click();
      await page.waitForTimeout(480);
    }

    // Parts -> line: the pedigree line leads into the tree, focused on the
    // same animal, with its line report open.
    await page.locator("[data-inspect-selected]").click();
    await page.waitForTimeout(700);
    await expect(page.locator("[data-inspector-pedigree]")).toBeVisible();
    await page.locator("[data-inspector-trace]").click();
    await page.waitForTimeout(800);
    await expect(page.locator("[data-inspector-overlay]")).toBeHidden();
    await expect(page.locator('[data-barn-scene="heritage"]')).toBeVisible();
    await expect(page.locator("[data-heritage-line]")).toBeVisible();
    const focused = (await page.locator("[data-heritage-info]").textContent()) ?? "";
    expect(focused).toContain("pts");
    expect(focused).toMatch(/line:|founder stock/);

    // Line -> parts: the tree's own Inspect button comes back.
    await page.locator("[data-inspect-dna]").first().click();
    await page.waitForTimeout(700);
    await expect(page.locator("[data-inspector-overlay]")).toBeVisible();
    await expect(page.locator("[data-inspector-pedigree]")).toBeVisible();
  });

  test("@smoke the Inspector reads a car in the context of its family", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(500);
    for (let generation = 0; generation < 5; generation += 1) {
      await page.locator("[data-run-generation]").click();
      await page.waitForTimeout(480);
    }

    await page.locator("[data-inspect-selected]").click();
    await page.waitForTimeout(700);
    await expect(page.locator("[data-inspector-pedigree]")).toBeVisible();
    const kin = (await page.locator("[data-inspector-kin]").textContent()) ?? "";
    // A founder reads as founder stock; anyone else names its pair. Either
    // way the family around it is stated.
    expect(kin).toMatch(/by #|founder stock/);
    expect(kin).toMatch(/siblings|descendants|founder stock/);
    const parents = kin.match(/by ([^·]+)/);
    if (parents) {
      // At most the biological pair, never every ancestry edge.
      expect(parents[1]!.split("+").length).toBeLessThanOrEqual(2);
    }

    // The stats read as English: one plate, not "1 plates".
    const stats = (await page.locator("[data-inspector-stats]").textContent()) ?? "";
    expect(stats).not.toContain("1 plates");
    expect(stats).not.toContain("1 wheels");
  });

  test("@smoke rain raises the bar and can turn a champion away", async ({ page }) => {
    // The same car, the same circuit, two skies: the bar moves, the champion
    // does not.
    const seed = async (hour: number) => {
      await page.goto(`${baseUrl}/dist/renderer/e2e.html`);
      await expect(page.locator("[data-status-message]")).toContainText("Welcome to");
      await page.evaluate(async () => {
        await window.vroomon.saveHallOfFame({
          version: 1,
          entries: [
            {
              id: "hall-sky-champ",
              runId: "r",
              dna: "Lhn4yi8zKRd2",
              name: "Sky Champ",
              score: 1550,
              terrainName: "Grassland",
              generation: 6,
              savedAt: new Date().toISOString(),
              notes: "",
            },
          ],
        });
        const world = await window.vroomon.loadWorldState();
        await window.vroomon.saveWorldState({
          ...world,
          rancherName: "E2E",
          feudTiers: { "Grassland Brand": 3 },
          timeOverride: 0.25,
        });
      });
      await page.reload();
      await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
      await page.evaluate(async (sky) => {
        const world = await window.vroomon.loadWorldState();
        await window.vroomon.saveWorldState({ ...world, timeOverride: sky });
      }, hour);
      await page.reload();
      await page.locator('[data-menu-action="continue"]').waitFor({ state: "visible", timeout: 20000 });
      await page.locator('[data-menu-action="continue"]').click();
      await page.waitForTimeout(600);
      await page.locator("[data-open-barn]").click();
      await page.waitForTimeout(400);
      await page.locator('[data-barn-pill="barn"]').click();
      await page.waitForTimeout(600);
      return ((await page.locator(".ledger-row").first().textContent()) ?? "").replace(/\s+/g, " ");
    };

    const clear = await seed(0.25);
    expect(clear).toContain("clears");

    const wet = await seed(0.5);
    expect(wet).toContain("short by");
    // Same car, higher bar: the rain is the only difference.
    expect(wet).toContain("Lhn4yi8zKRd2");
    // And the row offers a way to act on it, by name rather than by a shrug.
    expect(wet).toContain("Try it");
  });

  test("@smoke the heritage line report reads a branch as a pedigree", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(500);
    for (let generation = 0; generation < 4; generation += 1) {
      await page.locator("[data-run-generation]").click();
      await page.waitForTimeout(500);
    }
    await page.locator('[data-barn-pill="heritage"]').click();
    await page.waitForTimeout(900);

    // Tap along the fabric until a car is picked (founders and champions both
    // exist, and any of them traces a line).
    const canvas = page.locator("[data-heritage-canvas]");
    const box = await canvas.boundingBox();
    let picked = false;
    for (let gy = 0.1; gy <= 0.9 && !picked; gy += 0.1) {
      for (let gx = 0.05; gx <= 0.95 && !picked; gx += 0.04) {
        await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
        if (await page.locator("[data-heritage-line]").isVisible()) {
          picked = true;
        }
      }
    }
    expect(picked).toBe(true);

    // The report names its links, and puts the herd's own curve behind them.
    await expect(page.locator("[data-heritage-line]")).toContainText("LINE REPORT");
    await expect(page.locator(".heritage-line__row").first()).toContainText("gen ");
    await expect(page.locator("[data-heritage-line-series]")).toContainText("Herd best:");
    await expect(page.locator("[data-heritage-line-series]")).toContainText("best on this line");
  });

  test("@smoke every far road has someone on after dark", async ({ page }) => {
    await seedAndEnterWorld(page);

    // Three landmarks, each with a night keeper who is not there by day.
    const cases: Array<[string, number, number, string, string, string, RegExp]> = [
      // map, x, y, hour, name, job to take, the menu line that takes it
      ["mesa_switchback", 10, 8, "0.5", "", "", /$^/],
      ["mesa_switchback", 10, 8, "0.9", "Signal Lorn", "The Lamps Of The Mesa", /I'll run the face/],
      ["the_cut", 5, 7, "0.5", "", "", /$^/],
      ["the_cut", 5, 7, "0.9", "Night Powder Peg", "Night On The Spoil", /I'll take a night run/],
      ["marrow_orchard", 4, 9, "0.5", "", "", /$^/],
      ["marrow_orchard", 4, 9, "0.9", "Night-picker Sib", "The Late Rows", /I'll work the late rows/],
    ];

    for (const [mapId, x, y, hour, name, job, option] of cases) {
      await enterMapAt(page, mapId, x, y, "up", Number(hour));
      await page.keyboard.press("z");
      await page.waitForTimeout(600);
      if (!name) {
        // Nobody on shift at noon.
        await expect(page.locator("[data-overworld-dialogue-name]")).toHaveText("");
        continue;
      }
      await expect(page.locator("[data-overworld-dialogue-name]")).toContainText(name);
      await clickDialogueOption(page, option);
      await page.waitForTimeout(450);
      await page.locator("[data-overworld-dialogue-text]").click();
      await page.waitForTimeout(450);
      await expect(page.locator("[data-stats-quest-side]")).toContainText(job);
    }
  });

  test("@smoke the arenas have back rooms with a groom in them", async ({ page }) => {
    await seedAndEnterWorld(page);

    // The Rustler Pasture's tack room, through the door in the west wall.
    await enterMapAt(page, "gym_1", 2, 7, "left", 0.5);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Tack Room");

    // Millie has a finisher's ask.
    await enterMapAt(page, "rustler_tack_room", 6, 3, "right", 0.5);
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Groom Millie");
    await clickDialogueOption(page, /bring you a finisher/i);
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("A Finisher's Number");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("on the flat");

    // And the Salt Road Post's weighbridge has its own man.
    await enterMapAt(page, "salt_post_weighbridge", 5, 3, "left", 0.5);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Weighbridge");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Weighmaster Tuck");
    await clickDialogueOption(page, /weigh in/i);
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("Signed Off At The Scale");

    // The doors work both ways.
    await enterMapAt(page, "rustler_tack_room", 5, 4, "down", 0.5);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Rustler Pasture");
  });

  test("@smoke the ledger names what a swept circuit now asks for", async ({ page }) => {
    await seedAndEnterWorld(page);
    // Two laps on the board, and the Grassland already swept twice.
    await page.evaluate(async () => {
      await window.vroomon.saveRecords({
        version: 1,
        entries: [
          { terrainName: "Grassland", dna: "Lhn4yi8zKRd2", score: 1400, savedAt: new Date().toISOString() },
          { terrainName: "Sand", dna: "RuAp2owjBaqK", score: 400, savedAt: new Date().toISOString() },
        ],
      });
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, feudTiers: { "Grassland Brand": 3 } });
    });
    await page.reload();
    await page.locator('[data-menu-action="continue"]').waitFor({ state: "visible", timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(700);
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-barn-pill="barn"]').click();
    await page.waitForTimeout(700);

    const ledger = page.locator("[data-ledger-list] .ledger-row");
    await expect(ledger).not.toHaveCount(0);
    // The swept circuit reads as tier III, with the car that set the best and
    // how far short it now falls.
    await expect(page.locator("[data-ledger-list]")).toContainText("Grassland III");
    await expect(page.locator("[data-ledger-list]")).toContainText("Lhn4yi8zKRd2");
    await expect(page.locator("[data-ledger-list]")).toContainText("short by");
    // And the board sums up the work: defend, and ground never run.
    await expect(page.locator("[data-ledger-list]")).toContainText("DEFEND");
    await expect(page.locator("[data-ledger-list]")).toContainText("no run yet");

    // The row you are short on is a work list item: it sends you to that
    // ground with your best car already in the paddock.
    await page.locator("[data-ledger-prep]").first().click();
    await page.waitForTimeout(700);
    await expect(page.locator("[data-dna-input]")).toHaveValue("Lhn4yi8zKRd2");
    await expect(page.locator("[data-terrain-select]")).toHaveValue("Grassland");
    await expect(page.locator("[data-status-message]")).toContainText("Paddock set for Grassland");
  });

  test("@smoke the road landmarks have offices, and the shed works nights", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);

    // The Salt Road's freight office: a clerk who reads herds like ledgers.
    await enterMapAt(page, "salt_road_freight", 3, 4, "up", 0.5);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Salt Road Freight",
    );
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Clerk Nessa");
    await clickDialogueOption(page, /turn a line/i);
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("A Line That Moves");

    // The fuel shed is empty by day...
    await enterMapAt(page, "long_light_shed", 5, 3, "up", 0.5);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("The Fuel Shed");
    await page.keyboard.press("z");
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-name]")).toHaveText("");

    // ...and staffed after dark.
    await enterMapAt(page, "long_light_shed", 5, 3, "up", 0.95);
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Stoker Vane");
    await clickDialogueOption(page, /night shift/i);
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("The Night Shift");

    // And you can walk back out to the ice.
    await enterMapAt(page, "long_light_shed", 5, 4, "down", 0.95);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Long Light Depot");
  });

  test("@smoke night changes who is about: the watchman only works the dark", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);

    // Noon on the waystation street: his spot beside the fence is empty (the
    // player stands next to it, facing nothing).
    await enterMapAt(page, "long_haul", 7, 9, "right", 0.5);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("The Long Haul");
    await page.keyboard.press("z");
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-name]")).toHaveText("");

    // Night: he is standing there, and he has work for the dark.
    await enterMapAt(page, "long_haul", 7, 9, "right", 0.9);
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Watchman Pell");
    await clickDialogueOption(page, /work the dark/i);
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("Work The Dark");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("wild beaten on the Stretch");
  });

  test("@smoke people move with the day, and remember you", async ({ page }) => {
    await seedAndEnterWorld(page);
    // Morning: Jess is in the market square where she always is.
    await enterMapAt(page, "starter_town", 6, 7, "up");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Wrangler Jess");
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);

    // Dusk: she has moved to the well, and standing where she was finds nobody.
    await enterMapAt(page, "starter_town", 6, 7, "up", 0.7);
    await page.keyboard.press("z");
    await page.waitForTimeout(600);
    await expect(page.locator("[data-overworld-dialogue-name]")).toHaveText("");

    // Walk to the well instead and she is there (she moved off the Elder's
    // tile, which the position invariant now forbids).
    await enterMapAt(page, "starter_town", 3, 9, "right", 0.7);
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Wrangler Jess");

    // One Brand and she knows you; three and she calls you a champion.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({ ...world, badges: ["Grassland Brand"] });
    });
    await enterMapAt(page, "starter_town", 6, 7, "up", 0.25);
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText("Back off the grass");
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(400);

    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        badges: ["Grassland Brand", "Salt Road Brand", "Highland Brand"],
      });
    });
    await enterMapAt(page, "starter_town", 6, 7, "up", 0.25);
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-text]")).toContainText(
      "rider with a Brand",
    );
  });

  test("@smoke every far road has a landmark with a job on it", async ({ page }) => {
    await seedAndEnterWorld(page);
    // The landmark jobs chain behind the town board, so unlock them.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        tally: { ...(world?.tally ?? {}), "paid:town-board": 1 },
      });
    });

    const meetLandmark = async (
      mapId: string,
      x: number,
      y: number,
      facing: "up" | "down" | "left" | "right",
      option: number,
      giver: string,
      job: string,
      detail: string,
    ): Promise<void> => {
      await enterMapAt(page, mapId, x, y, facing);
      await page.keyboard.press("z");
      await page.waitForTimeout(700);
      await expect(page.locator("[data-overworld-dialogue-name]")).toContainText(giver);
      await page.locator("[data-dialogue-option]").nth(option).click();
      await page.waitForTimeout(500);
      await page.locator("[data-overworld-dialogue-text]").click();
      await page.waitForTimeout(500);
      await expect(page.locator("[data-stats-quest-side]")).toContainText(job);
      await expect(page.locator("[data-stats-quest-side]")).toContainText(detail);
    };

    // The Hills road: a cable hand who logs a climb.
    await meetLandmark(
      "mesa_switchback",
      4,
      6,
      "left",
      1,
      "Cable-hand Juno",
      "The Climb, Logged",
      "on the Mesa",
    );
    // The Quarry road: a face boss who wants a thousand on rock.
    await meetLandmark(
      "the_cut",
      9,
      4,
      "right",
      0,
      "Face Boss Halg",
      "A Thousand On Rock",
      "in the Quarry",
    );
    // The ice road: the last roof before the perimeter.
    await meetLandmark(
      "long_light_depot",
      4,
      5,
      "left",
      1,
      "Depot Keeper Sable",
      "Smooth On The Ice",
      "on the Perimeter",
    );

    // And you can walk back out of each one (the gate is a tile in from the
    // south edge, so step onto it).
    await enterMapAt(page, "long_light_depot", 6, 5, "down");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Drift Perimeter");
  });

  test("@smoke the waystation's rooms: a cookhouse job for turning stock out", async ({
    page,
  }) => {
    await seedAndEnterWorld(page);
    // Stand below the doormat and step ONTO it: gates fire when you move in.
    await enterMapAt(page, "long_haul", 3, 5, "up");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("The Long Haul");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("Cookhouse");

    // Walk over to the sink and face Nim: two left, one down, then turn left
    // (walking into somebody only turns you to face them).
    for (const key of ["ArrowLeft", "ArrowLeft", "ArrowDown", "ArrowLeft"] as const) {
      await page.keyboard.press(key);
      await page.waitForTimeout(280);
    }
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Pot-washer Nim");
    await expect(page.locator("[data-dialogue-option]")).toHaveCount(3);
    await page.locator("[data-dialogue-option]").first().click();
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);

    // Releasing stock now has a face and a reward behind it.
    await expect(page.locator("[data-stats-quest-side]")).toContainText("Out Past The Fence");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("turned out");

    // Turning one out past the fence counts.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        tally: { ...(world?.tally ?? {}), released: 2 },
      });
    });
    await page.reload();
    await page.locator('[data-menu-action="continue"]').waitFor({ state: "visible", timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(1000);
    await enterMapAt(page, "long_haul_cookhouse", 3, 4, "left");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("2/3");
  });

  test("@smoke The Long Haul: a road stop with work for a working book", async ({ page }) => {
    await seedAndEnterWorld(page);
    await enterMapAt(page, "long_haul", 4, 6, "left");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("The Long Haul");

    // Cook Ada feeds the lane and wants proof the herd is worth it.
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Cook Ada");
    await page.locator("[data-dialogue-option]").nth(1).click();
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    // It sits behind the orchard's cutting, so it stays off the board.
    await expect(page.locator("[data-stats-quest-side]")).toHaveCount(0);

    // The drover's job, though, is open — and counts grounds in the book.
    await enterMapAt(page, "long_haul", 14, 6, "left");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Drover Holt");
    await page.locator("[data-dialogue-option]").nth(1).click();
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("Four Grounds");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("grounds in your Herd Book");

    // Three grounds of notes is not four.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      const notes: Record<string, { mapId: string; score: number; caughtAt: string; origin: "caught" }> = {};
      for (const [index, mapId] of ["ranch_yard", "route_2", "hills_map"].entries()) {
        notes[`sample${index}`] = {
          mapId,
          score: 200 + index,
          caughtAt: new Date().toISOString(),
          origin: "caught",
        };
      }
      await window.vroomon.saveWorldState({ ...world, specimenMeta: notes });
    });
    await page.reload();
    await page.locator('[data-menu-action="continue"]').waitFor({ state: "visible", timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(1000);
    await enterMapAt(page, "long_haul", 14, 6, "left");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("3/4");
  });

  test("@smoke the Herd Book remembers where a specimen came off", async ({ page }) => {
    await seedAndEnterWorld(page);
    await enterMapAt(page, "ranch_yard", 7, 3);
    // A car good enough to win the catch, so provenance has something to note.
    await seedHerdDna(page, "Lhn4yi8zKRd2");

    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();
    await page.locator("[data-wild-race-run]").click();
    await page.waitForTimeout(4500);
    await expect(page.locator("[data-wild-race-verdict]")).toContainText("Beaten by");
    await page.locator("[data-wild-race-leave]").click();
    await expect.poll(async () => vroomdexCount(page), { timeout: 8000 }).toBe(1);

    // The note was written with the ground and the race.
    const noted = await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      const dna = (world?.vroomdex ?? [])[0] ?? "";
      return { dna, meta: world?.specimenMeta?.[dna] ?? null };
    });
    expect(noted.meta).not.toBeNull();
    expect(noted.meta?.mapId).toBe("ranch_yard");
    expect(noted.meta?.origin).toBe("caught");

    // And the Herd Book scene reads it back in words.
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-barn-pill="dex"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-dex-summary]")).toContainText("1 specimen");
    await expect(page.locator("[data-dex-list] .dex-row").first()).toContainText("CAUGHT");
    await expect(page.locator("[data-dex-list] .dex-row").first()).toContainText(
      "the Shoddy Ranch paddock",
    );
  });

  test("@smoke a far-biome job unlocks once the job before it is paid", async ({ page }) => {
    await seedAndEnterWorld(page);
    // The Frost Baron's Watch job sits behind Wrangler Jess's muster.
    await enterMapAt(page, "ice_map", 11, 6, "right");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText(
      "The Frost Baron",
    );
    await expect(page.locator("[data-dialogue-option]")).toHaveCount(4);
    await page.locator("[data-dialogue-option]", { hasText: "Watch need" }).click();
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);

    // Taken, but not on the board yet: its prerequisite is unpaid.
    await expect(page.locator("[data-stats-quest-side]")).toHaveCount(0);

    // Pay the muster (what the town's wrangler asks for) and come back.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        tally: { ...(world?.tally ?? {}), "paid:wranglers-muster": 1 },
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(1000);
    await enterMapAt(page, "ice_map", 11, 6, "right");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("The Perimeter Watch");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("0/2");

    // A win on this biome's ground counts toward it (the road total does not).
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        tally: { ...(world?.tally ?? {}), wildWins: 9, "wildWins:ice_map": 1 },
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(1000);
    await enterMapAt(page, "ice_map", 11, 6, "right");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("1/2");
  });

  test("@smoke Oxide's counter buys specimens and sells road stock", async ({ page }) => {
    await seedAndEnterWorld(page);
    // A herd (which persists a run), two specimens, and one biome's pack.
    await seedHerdDna(page, "Lhn4yi8zKRd2");
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        vroomdex: ["UoZzJLj1FOFC", "obAosdxh1rqm"],
        wildPacks: { ranch_yard: ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"] },
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(600);

    // Fund the wallet so the counter has something to trade against.
    await page.evaluate(async () => {
      const run = await window.vroomon.loadRunState();
      if (run) {
        await window.vroomon.saveRunState({ ...run, wallet: 500 });
      }
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(600);

    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-barn-pill="market"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-market-wallet]")).toHaveText("500");
    await expect(page.locator("[data-market-offers] .market-row")).not.toHaveCount(0);
    await expect(page.locator("[data-market-specimens] .market-row")).not.toHaveCount(0);

    // Selling a specimen pays out.
    const sellPrice = Number(
      ((await page.locator("[data-market-sell]").first().textContent()) ?? "0").replace(/\D/g, ""),
    );
    expect(sellPrice).toBeGreaterThan(0);
    await page.locator("[data-market-sell]").first().click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-market-wallet]")).toHaveText(String(500 + sellPrice));

    // Buying road stock spends it, and the animal joins the herd.
    const buyPrice = Number(
      ((await page.locator("[data-market-buy]").first().textContent()) ?? "0").replace(/\D/g, ""),
    );
    const boughtDna = (
      (await page.locator("[data-market-offers] .market-row__dna").first().textContent()) ?? ""
    ).trim();
    expect(buyPrice).toBeGreaterThan(0);
    await page.locator("[data-market-buy]").first().click();
    await page.waitForTimeout(700);
    await expect(page.locator("[data-market-wallet]")).toHaveText(
      String(500 + sellPrice - buyPrice),
    );
    const after = await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      const run = await window.vroomon.loadRunState();
      return {
        vroomdex: world?.vroomdex ?? [],
        herd: (run?.population ?? []).map((entry) => entry.dna),
        wallet: run?.wallet ?? 0,
      };
    });
    expect(after.vroomdex).toContain(boughtDna);
    expect(after.herd).toContain(boughtDna);
  });

  test("@smoke Marrow Orchard: a keeper, a race, and a job worth taking", async ({ page }) => {
    await seedAndEnterWorld(page);

    // The keeper's cutting: take it, and it lands in the HUD.
    await enterMapAt(page, "marrow_orchard", 3, 11, "left");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText(
      "Orchard Keeper Maren",
    );
    await page.locator("[data-dialogue-option]").nth(1).click();
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-stats-quest-side]")).toContainText("A Marrow Cutting");
    await expect(page.locator("[data-stats-quest-side]")).toContainText("0/900");

    // Sprout will race anyone who comes up the lane.
    await enterMapAt(page, "marrow_orchard", 13, 5, "up");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Marrow Orchard",
    );
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Sprout");
    await page.locator("[data-dialogue-option]").first().click();
    await page.waitForTimeout(500);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(900);
    await expect(page.locator("[data-status-message]")).toContainText("Rider race");
  });

  test("@smoke the hedge maze is a real map: a keeper, a gate, and a way back", async ({ page }) => {
    await seedAndEnterWorld(page);

    // The orchard's east hedge has a gap in it now, and stepping onto the
    // doormat in that gap walks you into the generated maze.
    await enterMapAt(page, "marrow_orchard", 16, 11, "down");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Marrow Orchard",
    );
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Marrow Hedge Maze",
    );

    // The keeper stands on a dead end a few tiles in — somewhere a person
    // cannot wall off the only route to the middle.
    await enterMapAt(page, "hedge_maze", 7, 12, "up");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Marrow Hedge Maze",
    );
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText(
      "Hedge Keeper Bram",
    );
    await expect(page.locator("[data-dialogue-option]")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // You arrive one tile inside the gate rather than on it, so the way back
    // is a step you choose — and it still works.
    await enterMapAt(page, "hedge_maze", 1, 2, "down");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Marrow Orchard",
    );
  });

  test("@smoke the Deep is a second maze: down the Quarry shaft, back up again", async ({ page }) => {
    await seedAndEnterWorld(page);

    // The old shaft in the Quarry's south-east spoil drops into the Deep.
    await enterMapAt(page, "rocky_map", 14, 9, "down");
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Canyon Quarry",
    );
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("The Deep");

    // A shaft boss on a dead end, with a lampman and a racer further in.
    await enterMapAt(page, "the_deep", 8, 9, "right");
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText(
      "Shaft Boss Rell",
    );
    await expect(page.locator("[data-dialogue-option]")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // ...and the gate is one step inside the arrival, so you can leave.
    await enterMapAt(page, "the_deep", 1, 2, "down");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(900);
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText(
      "Canyon Quarry",
    );
  });

  test("@smoke a side quest is offered, tracked, and paid on completion", async ({ page }) => {
    await seedAndEnterWorld(page);
    await enterMapAt(page, "starter_town", 6, 7);

    // Wrangler Jess is one tile up: take her muster.
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    await page.keyboard.press("z");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-overworld-dialogue-name]")).toContainText("Wrangler Jess");
    await page.locator("[data-dialogue-option]").first().click();
    await page.waitForTimeout(600);
    await page.locator("[data-overworld-dialogue-text]").click();
    await page.waitForTimeout(500);

    // The job shows up in the HUD with its progress.
    await expect(page.locator("[data-stats-quest-side]")).toContainText(
      "The Wrangler's Muster",
    );
    await expect(page.locator("[data-stats-quest-side]")).toContainText("0/3");

    // Do the work (three wild races won is a tally the world keeps), then
    // reload: the boot settles anything finished while away.
    await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        tally: { ...(world?.tally ?? {}), wildWins: 3 },
      });
    });
    await page.reload();
    await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
    await page.locator('[data-menu-action="continue"]').click();
    await page.waitForTimeout(1200);

    const settled = await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      const run = await window.vroomon.loadRunState();
      return {
        paid: world?.tally?.["paid:wranglers-muster"] ?? 0,
        wallet: run?.wallet ?? 0,
        feed: run?.feed ?? 0,
      };
    });
    expect(settled.paid).toBe(1);
    expect(settled.wallet).toBeGreaterThanOrEqual(120);
    expect(settled.feed).toBeGreaterThanOrEqual(3);
    // A finished job leaves the nag list.
    await expect(page.locator("[data-stats-quest-side]")).toHaveCount(0);
  });

  test("@smoke the wild pack evolves on its own between meetings", async ({ page }) => {
    await seedAndEnterWorld(page);
    await enterMapAt(page, "ranch_yard", 6, 3);
    await seedHerdDna(page, "Lhn4yi8zKRd2");

    const meetWild = async (): Promise<{ generation: string; wild: string }> => {
      // Step off the grass and back on, so the tile triggers again.
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(350);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(350);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(900);
      await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();
      const sub = (await page.locator("[data-wild-race-sub]").textContent()) ?? "";
      const lanes = (await page.locator("[data-wild-race-lanes]").textContent()) ?? "";
      // Find the pack line by what it says rather than by position: the
      // panel carries the place, the terrain stock, the generation, its
      // ceiling and the sky, and fields get added.
      const generation =
        sub
          .split("·")
          .map((part) => part.trim())
          .find((part) => part.includes("founders") || part.includes("wild gen")) ?? "";
      return { generation, wild: lanes.split("WILD")[1]?.slice(0, 32) ?? "", sub };
    };

    const first = await meetWild();
    expect(first.generation).toContain("the founders");
    // The ground names itself and what it breeds.
    expect(first.sub).toContain("stock");
    await page.locator("[data-wild-race-leave]").click();
    await page.waitForTimeout(400);

    const second = await meetWild();
    // Nobody is steering it: the pack turned over one generation, and the
    // vroomon out there now is one the ground selected for.
    expect(second.generation).toContain("wild gen 2");
    expect(second.wild).not.toBe(first.wild);
    await page.locator("[data-wild-race-leave]").click();
    await page.waitForTimeout(600);

    // The world HUD carries the biome's wild generation, so the arms race is
    // visible while walking rather than only at the moment of a race.
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("WILD");

    // And the Record Barn's wild table says which grounds you have met, how
    // far each has come and what it would send - the "where you hunt matters"
    // fact, on a screen rather than only in the moment of a race.
    await page.locator("[data-open-barn]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-barn-pill="barn"]').click();
    await page.waitForTimeout(400);
    const wildTable = page.locator("[data-wild-grounds]");
    await expect(wildTable).toContainText("Ranch Yard");
    await expect(wildTable).toContainText("wild gen");
    await expect(wildTable).toContainText("sends");
    // And the question the table is really answering: does any of it clear the
    // bar in front of you?
    await expect(page.locator("[data-wild-hint]")).toContainText("FOR ");
    await expect(page.locator("[data-wild-hint]")).toContainText(/worth the walk|Nothing met sends|No pack met/);
    // A record is read against the alternative: what that terrain's wild would
    // hand you. Any recorded lap on a met terrain carries the comparison.
    const recordRows = page.locator(".records-row");
    if ((await recordRows.count()) > 0) {
      await expect(recordRows.first()).toContainText("px best");
    }
    await closePocketRanch(page);

    // And the world HUD carries what this ground sends, so the arms race is
    // visible while walking rather than only at the moment of a race.
    await expect(page.locator("[data-viewport-stats-overlay]")).toContainText("sends");

    // The Inspector reads a car against the same number, on the same ground:
    // "is it worth a walk?" answered where the car is.
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(500);
    await runOneGeneration(page);
    await page.locator("[data-inspect-selected]").click();
    await page.waitForTimeout(700);
    await page.locator('[data-inspector-terrain="Grassland"]').click();
    await page.waitForTimeout(900);
    await expect(page.locator("[data-inspector-result]")).toContainText("wild sends");
    // Escape drops the inspector, and the hub with it, so there is nothing to
    // close afterwards.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(page.locator("[data-inspector-overlay]")).toBeHidden();

    // The pack and its generation count ride along in the save.
    const generations = await page.evaluate(async () => {
      const world = await window.vroomon.loadWorldState();
      return world?.wildGenerations ?? {};
    });
    expect(generations.ranch_yard).toBeGreaterThanOrEqual(1);
  });

  test("@smoke a wild vroomon only joins the herd if you beat it", async ({ page }) => {
    // The wild is deterministic now: every biome founds the same pack, so
    // these runs are reproducible without touching Math.random.
    await seedAndEnterWorld(page);
    await enterMapAt(page, "ranch_yard", 7, 3);
    await seedHerdDna(page, "vcG5pzmORWqC");

    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();

    // No genome before the race is run.
    expect(await vroomdexCount(page)).toBe(0);
    await page.locator("[data-wild-race-run]").click();
    await page.waitForTimeout(4500);
    await expect(page.locator("[data-wild-race-verdict]")).toContainText("Beaten by");
    await page.locator("[data-wild-race-leave]").click();
    await page.waitForTimeout(2000);
    await expect.poll(async () => vroomdexCount(page), { timeout: 8000 }).toBe(1);
  });

  test("a wild vroomon that outruns you gets away", async ({ page }) => {
    await seedAndEnterWorld(page);
    await enterMapAt(page, "ranch_yard", 7, 3);
    // A car that cannot move: whatever the wild is, it loses.
    await seedHerdDna(page, "000000000000");

    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    await expect(page.locator("[data-wild-race-overlay]")).toBeVisible();
    await page.locator("[data-wild-race-run]").click();
    await page.waitForTimeout(4500);
    await expect(page.locator("[data-wild-race-verdict]")).toContainText("got away");
    await page.locator("[data-wild-race-leave]").click();
    await page.waitForTimeout(900);
    expect(await vroomdexCount(page)).toBe(0);
  });


/** Drop the rancher on a specific map tile (and reload so it takes). */
async function enterMapAt(
  page: import("@playwright/test").Page,
  mapId: string,
  x: number,
  y: number,
  facing: "up" | "down" | "left" | "right" = "down",
  hour = 0.25,
): Promise<void> {
  await page.evaluate(
    async ({ mapId: id, x: px, y: py, facing: pf, hour: ph }) => {
      const world = await window.vroomon.loadWorldState();
      await window.vroomon.saveWorldState({
        ...world,
        version: 1,
        lastSavedAt: new Date().toISOString(),
        rancherName: "E2E",
        currentMapId: id,
        playerX: px,
        playerY: py,
        playerFacing: pf,
        hunting: true,
        timeOverride: ph,
        flags: { ...(world?.flags ?? {}), "opening-seen": true },
      });
    },
    { mapId, x, y, facing, hour },
  );
  await page.reload();
  await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
  await page.locator('[data-menu-action="continue"]').click();
  await page.waitForTimeout(600);
}

/** Put one known genome in the herd so there is a car to race with. */
/**
 * Press Run Gen and wait for the generation to actually land.
 *
 * The herd panel repaints as a generation finishes, which replaces the button
 * node — so a click dispatched at the wrong moment goes to a detached element
 * and is simply lost. Retry until the pill moves, rather than assuming one
 * click is enough.
 */
async function runOneGeneration(page: import("@playwright/test").Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = (await page.locator("[data-viewport-gen-value]").textContent()) ?? "";
    await page.locator("[data-run-generation]").click({ force: true });
    const advanced = await page
      .waitForFunction(
        (previous) =>
          (document.querySelector("[data-viewport-gen-value]")?.textContent ?? "") !== previous,
        before,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    if (advanced) {
      return;
    }
  }
  throw new Error("Run Gen never advanced the generation");
}

async function seedHerdDna(page: import("@playwright/test").Page, dna: string): Promise<void> {
  await openPocketRanch(page, "herd");
  await page.locator("[data-import-dna]").fill(dna);
  await page.locator("[data-seed-import-dna]").click();
  await page.waitForTimeout(400);
  // Seed AFTER any reload: the herd lives in memory, so reloading to move
  // maps would come back with nothing to race.
  await page.locator("[data-barn-close]").click();
  await page.waitForTimeout(300);
}

async function vroomdexCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(async () => {
    const world = await window.vroomon.loadWorldState();
    return (world?.vroomdex ?? []).length;
  });
}

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
      // Pin the hour: people move with the day now, and a test needs the same
      // street every run.
      timeOverride: 0.25,
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

  test("@smoke the inspector shows every part and runs a track", async ({ page }) => {
    await seedAndEnterWorld(page);
    await openPocketRanch(page, "herd");
    await page.locator("[data-generate-population]").click();
    await page.waitForTimeout(400);
    await page.locator('[data-barn-pill="drive"]').click();
    await page.waitForTimeout(400);
    await page.locator("[data-dna-input]").fill("fq4j7dJgZAic");
    await page.waitForTimeout(700);

    // The paddock's own readout carries the circuit verdict too, so the same
    // answer appears wherever a car is described.
    await expect(page.locator("[data-blueprint-circuit]")).toBeVisible();
    await expect(page.locator("[data-blueprint-circuit]")).toContainText("CIRCUIT");
    await expect(page.locator("[data-blueprint-circuit]")).toContainText(
      /fits the ground|The ground wants|asks nothing of the build/,
    );

    await page.locator("[data-inspect-draft]").click();
    await expect(page.locator("[data-inspector-overlay]")).toBeVisible();
    await expect(page.locator("[data-inspector-title]")).toContainText("fq4j7dJgZAic");

    // One row per chain slot: frame and powertrain are parallel arrays.
    await expect(page.locator(".inspector__part")).toHaveCount(6);
    await expect(page.locator("[data-inspector-stats]")).toContainText("Structure");
    await expect(page.locator("[data-inspector-stats]")).toContainText("Driven wheels");
    // And what the circuit would say about it: the shape demand of the ground
    // the player is breeding for, answered for this car.
    await expect(page.locator("[data-inspector-stats]")).toContainText("Circuit shape");
    // Tier I asks nothing of the build, so the row says that; higher tiers
    // either confirm the car or name what is missing.
    await expect(page.locator("[data-inspector-stats]")).toContainText(
      /fits the ground|The ground wants|asks nothing of the build/,
    );

    // Every row names its structure and its powertrain module.
    await expect(page.locator(".inspector__part").first()).toContainText("plate");
    await expect(page.locator(".inspector__part").nth(2)).toContainText("wheel");

    // Run it on a second track and read the verdict back.
    await page.locator('[data-inspector-terrain="Rocky"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator("[data-inspector-result]")).toContainText("Rocky");

    // The run plays back rather than only reporting: the clock advances.
    await page.waitForTimeout(700);
    const clockMid = await page.locator("[data-inspector-clock]").textContent();
    expect(Number.parseFloat(clockMid ?? "0")).toBeGreaterThan(0);

    // It draws above the Pocket Ranch hub it was opened from (the window
    // rendered behind the hub once, which looked like nothing happening).
    const onTop = await page.evaluate(() => {
      const element = document.elementFromPoint(window.innerWidth / 2, 120);
      return Boolean(element?.closest("[data-inspector-overlay]"));
    });
    expect(onTop).toBe(true);

    // The canvas paints the car: parts drawn, not an empty sheet.
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-inspector-canvas]");
      if (!canvas) return -1;
      const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data) return -1;
      let coloured = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) coloured += 1;
      }
      return coloured;
    });
    expect(painted).toBeGreaterThan(500);

    await page.locator("[data-inspector-close]").click();
    await expect(page.locator("[data-inspector-overlay]")).toBeHidden();
  });

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
