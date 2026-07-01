import { describe, expect, it } from "vitest";

import { advanceRunState, runEvolutionGeneration } from "../src/core/population.js";
import {
  VROOMON_PARITY_CONTRACT,
  type HallOfFameEntry,
} from "../src/shared/parity-contract.js";
import {
  DEFAULT_BATCH_GENERATION_COUNT,
  DEFAULT_EVOLUTION_VIEWPORT_FRAME_COUNT,
  DEFAULT_EVOLUTION_VIEWPORT_STEP_COUNT,
  DEFAULT_TEST_DRIVE_FRAME_COUNT,
  DEFAULT_TEST_DRIVE_STEP_COUNT,
  addHallOfFameEntry,
  applyBatchGeneration,
  applyGenerationToState,
  createRendererState,
  detectConvergence,
  getSelectedVehicleSummary,
  removeHallOfFameEntry,
  renameHallOfFameEntry,
  selectHallEntry,
  selectVehicle,
  setBatchCount,
  setBatchRunning,
  setConvergeMode,
  setDraftDna,
  setHallOfFame,
  setRendererMode,
  setRendererRunState,
  setRendererTerrain,
  setRunConfig,
  setTestDriveReplay,
  updateBatchProgress,
} from "../src/renderer/state.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";

describe("renderer state", () => {
  it("switches between menu and app modes", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const testDriveState = setRendererMode(state, "test-drive");
    const evolutionState = setRendererMode(state, "evolution");

    expect(testDriveState.mode).toBe("test-drive");
    expect(testDriveState.runState.mode).toBe("test-drive");
    expect(testDriveState.statusMessage).toBe("Viewing test-drive mode.");
    expect(evolutionState.mode).toBe("evolution");
    expect(evolutionState.runState.mode).toBe("evolution");
    expect(evolutionState.statusMessage).toBe("Viewing evolution mode.");
  });

  it("tracks terrain changes in the run state", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    expect(setRendererTerrain(state, "Flat").runState.terrainName).toBe("Flat");
  });

  it("clears stale generation data when terrain changes", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const generation = runEvolutionGeneration({
      ...state.runState,
      population: [
        { id: "preview-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "preview-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "preview-00001": [],
        "preview-00002": [],
      },
    });
    const nextState = applyGenerationToState(
      state,
      generation,
      advanceRunState(state.runState, generation),
    );
    const flatState = setRendererTerrain(nextState, "Flat");

    expect(flatState.latestGeneration).toBeNull();
    expect(flatState.lastEvaluatedRunState).toBeNull();
    expect(flatState.selectedVehicleId).toBeNull();
    expect(flatState.statusMessage).toContain("Flat");
  });

  it("selects the best vehicle after a generation is applied", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const generation = runEvolutionGeneration({
      ...state.runState,
      population: [
        { id: "preview-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "preview-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "preview-00001": [],
        "preview-00002": [],
      },
    });

    const nextState = applyGenerationToState(
      state,
      generation,
      advanceRunState(state.runState, generation),
    );

    expect(nextState.latestGeneration).not.toBeNull();
    expect(nextState.lastEvaluatedRunState).toEqual(state.runState);
    expect(nextState.selectedVehicleId).toBeTruthy();
    expect(nextState.runState.generation).toBe(1);
    expect(nextState.mode).toBe("evolution");
  });

  it("returns selected vehicle summaries for the sidebar", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const generation = runEvolutionGeneration({
      ...state.runState,
      population: [
        { id: "preview-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "preview-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "preview-00001": [],
        "preview-00002": [],
      },
    });
    const nextState = selectVehicle(
      applyGenerationToState(
        state,
        generation,
        advanceRunState(state.runState, generation),
      ),
      generation.evaluatedPopulation[0]!.id,
    );

    expect(getSelectedVehicleSummary(nextState)).toMatchObject({
      id: generation.evaluatedPopulation[0]!.id,
    });
  });

  it("adopts the loaded run mode when a saved state is restored", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const loadedState = createEmptyRunState("test-drive", "Flat", "loaded-run");

    const nextState = setRendererRunState(state, loadedState, "Loaded run.");

    expect(nextState.mode).toBe("test-drive");
    expect(nextState.runState.mode).toBe("test-drive");
  });

  it("stores replay settings for the flat-track regression viewer", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const replayState = setTestDriveReplay(state, {
      dna: "aaaaaaaaaaaa",
      terrainName: "Flat",
      stepCount: 11_000,
      frameCount: 96,
      playbackDurationMs: 12_000,
      label: "flat-track regression replay",
      statusMessage: "Watching flat-track regression replay.",
    });
    const resetState = setDraftDna(replayState, "zzYY1199ABcd");

    expect(replayState.mode).toBe("test-drive");
    expect(replayState.runState.terrainName).toBe("Flat");
    expect(replayState.testDriveStepCount).toBe(11_000);
    expect(replayState.testDriveFrameCount).toBe(96);
    expect(replayState.testDrivePlaybackDurationMs).toBe(12_000);
    expect(replayState.testDriveScenarioLabel).toBe("flat-track regression replay");
    expect(resetState.testDriveStepCount).toBe(DEFAULT_TEST_DRIVE_STEP_COUNT);
    expect(resetState.testDriveFrameCount).toBe(DEFAULT_TEST_DRIVE_FRAME_COUNT);
    expect(resetState.testDrivePlaybackDurationMs).toBeNull();
    expect(resetState.testDriveScenarioLabel).toBeNull();
  });

  it("sets batch generation count", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    expect(state.batchCount).toBe(DEFAULT_BATCH_GENERATION_COUNT);
    expect(setBatchCount(state, 25).batchCount).toBe(25);
  });

  it("ships smooth, long-enough viewport simulation defaults", () => {
    // The viewport used to capture 24 frames over ~1.5-2s, which looked
    // steppy and looped too aggressively. The defaults now sample more
    // physics steps and more keyframes so the rAF interpolator has dense
    // enough data to tween smoothly.
    expect(DEFAULT_TEST_DRIVE_STEP_COUNT).toBeGreaterThanOrEqual(360);
    expect(DEFAULT_TEST_DRIVE_FRAME_COUNT).toBeGreaterThanOrEqual(60);
    expect(DEFAULT_EVOLUTION_VIEWPORT_STEP_COUNT).toBeGreaterThanOrEqual(360);
    expect(DEFAULT_EVOLUTION_VIEWPORT_FRAME_COUNT).toBeGreaterThanOrEqual(60);

    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    expect(state.testDriveStepCount).toBe(DEFAULT_TEST_DRIVE_STEP_COUNT);
    expect(state.testDriveFrameCount).toBe(DEFAULT_TEST_DRIVE_FRAME_COUNT);
  });

  it("tracks batch running state", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const runningState = setBatchRunning(state, true);
    expect(runningState.batchRunning).toBe(true);
    expect(runningState.batchCompleted).toBe(0);

    const progressState = updateBatchProgress(runningState, 5, "5/10 done.");
    expect(progressState.batchCompleted).toBe(5);
    expect(progressState.statusMessage).toBe("5/10 done.");

    const stoppedState = setBatchRunning(progressState, false);
    expect(stoppedState.batchRunning).toBe(false);
    expect(stoppedState.batchCompleted).toBe(5);
  });

  it("applies a batch generation and tracks progress", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const runnableState = {
      ...state.runState,
      population: [
        { id: "preview-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "preview-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "preview-00001": [],
        "preview-00002": [],
      },
    };

    const generation = runEvolutionGeneration(runnableState);
    const nextState = advanceRunState(runnableState, generation);

    const batchState = applyBatchGeneration(state, generation, nextState, 3, 10);

    expect(batchState.mode).toBe("evolution");
    expect(batchState.runState.generation).toBe(1);
    expect(batchState.batchCompleted).toBe(3);
    expect(batchState.statusMessage).toContain("3/10 generations");
    expect(batchState.latestGeneration).toEqual(generation);
    expect(batchState.lastEvaluatedRunState).toEqual(state.runState);
  });

  it("appends score history entries when applying a generation", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const runnableState = {
      ...state.runState,
      population: [
        { id: "preview-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "preview-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "preview-00001": [],
        "preview-00002": [],
      },
    };

    const generation1 = runEvolutionGeneration(runnableState);
    const nextState1 = advanceRunState(runnableState, generation1);
    const state1 = applyGenerationToState(state, generation1, nextState1);

    expect(state1.scoreHistory).toHaveLength(1);
    expect(state1.scoreHistory[0]!.generation).toBe(1);
    expect(state1.scoreHistory[0]!.bestScore).toBeGreaterThanOrEqual(0);
    expect(state1.scoreHistory[0]!.meanScore).toBeGreaterThanOrEqual(0);
    expect(state1.scoreHistory[0]!.populationSize).toBe(2);

    const generation2 = runEvolutionGeneration(nextState1);
    const nextState2 = advanceRunState(nextState1, generation2);
    const state2 = applyGenerationToState(state1, generation2, nextState2);

    expect(state2.scoreHistory).toHaveLength(2);
    expect(state2.scoreHistory[1]!.generation).toBe(2);
  });

  it("appends score history during batch generations", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const runnableState = {
      ...state.runState,
      population: [
        { id: "preview-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "preview-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "preview-00001": [],
        "preview-00002": [],
      },
    };

    const generation1 = runEvolutionGeneration(runnableState);
    const nextState1 = advanceRunState(runnableState, generation1);
    const batchState = applyBatchGeneration(state, generation1, nextState1, 1, 5);

    expect(batchState.scoreHistory).toHaveLength(1);
    expect(batchState.scoreHistory[0]!.generation).toBe(1);

    const generation2 = runEvolutionGeneration(nextState1);
    const nextState2 = advanceRunState(nextState1, generation2);
    const batchState2 = applyBatchGeneration(batchState, generation2, nextState2, 2, 5);

    expect(batchState2.scoreHistory).toHaveLength(2);
    expect(batchState2.scoreHistory[1]!.generation).toBe(2);
  });

  it("toggles convergence mode", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    expect(state.convergeMode).toBe(true);
    expect(setConvergeMode(state, false).convergeMode).toBe(false);
    expect(setConvergeMode(state, true).convergeMode).toBe(true);
  });

  it("detects convergence when scores plateau", () => {
    const history = [
      { generation: 1, bestScore: 100, meanScore: 50, populationSize: 10 },
      { generation: 2, bestScore: 102, meanScore: 52, populationSize: 10 },
      { generation: 3, bestScore: 101, meanScore: 51, populationSize: 10 },
      { generation: 4, bestScore: 103, meanScore: 53, populationSize: 10 },
      { generation: 5, bestScore: 101, meanScore: 50, populationSize: 10 },
    ];

    const result = detectConvergence(history, 3, 0.05);
    expect(result.converged).toBe(true);
    expect(result.message).toContain("plateaued");
  });

  it("does not detect convergence with rising scores", () => {
    const history = [
      { generation: 1, bestScore: 10, meanScore: 5, populationSize: 10 },
      { generation: 2, bestScore: 50, meanScore: 25, populationSize: 10 },
      { generation: 3, bestScore: 120, meanScore: 60, populationSize: 10 },
      { generation: 4, bestScore: 300, meanScore: 150, populationSize: 10 },
      { generation: 5, bestScore: 500, meanScore: 250, populationSize: 10 },
    ];

    const result = detectConvergence(history, 3, 0.02);
    expect(result.converged).toBe(false);
  });

  it("requires enough history to detect convergence", () => {
    const history = [
      { generation: 1, bestScore: 100, meanScore: 50, populationSize: 10 },
      { generation: 2, bestScore: 110, meanScore: 55, populationSize: 10 },
    ];

    const result = detectConvergence(history, 3, 0.02);
    expect(result.converged).toBe(false);
    expect(result.message).toContain("Not enough");
  });

  it("initializes hall of fame as empty", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    expect(state.hallOfFame.version).toBe(1);
    expect(state.hallOfFame.entries).toEqual([]);
    expect(state.selectedHallEntryId).toBeNull();
  });

  it("adds and removes hall of fame entries", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const entry1: HallOfFameEntry = {
      id: "hall-1",
      runId: "preview",
      dna: "A3x9K2m7P4zQ",
      name: "Champion",
      score: 250,
      terrainName: "Flat",
      generation: 5,
      savedAt: "2024-01-01T00:00:00.000Z",
      notes: "",
    };

    const withEntry = addHallOfFameEntry(state, entry1);
    expect(withEntry.hallOfFame.entries).toHaveLength(1);
    expect(withEntry.hallOfFame.entries[0]?.name).toBe("Champion");
    expect(withEntry.selectedHallEntryId).toBe("hall-1");

    const entry2: HallOfFameEntry = {
      id: "hall-2",
      runId: "preview",
      dna: "zzYY1199ABcd",
      name: "Runner-up",
      score: 180,
      terrainName: "Grassland",
      generation: 3,
      savedAt: "2024-01-02T00:00:00.000Z",
      notes: "",
    };

    const withTwo = addHallOfFameEntry(withEntry, entry2);
    expect(withTwo.hallOfFame.entries).toHaveLength(2);
    expect(withTwo.hallOfFame.entries[0]?.id).toBe("hall-2");

    const removed = removeHallOfFameEntry(withTwo, "hall-1");
    expect(removed.hallOfFame.entries).toHaveLength(1);
    expect(removed.hallOfFame.entries[0]?.id).toBe("hall-2");
    expect(removed.selectedHallEntryId).toBe("hall-2");
  });

  it("selects hall of fame entries", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const withSelection = selectHallEntry(state, "hall-1");
    expect(withSelection.selectedHallEntryId).toBe("hall-1");

    const cleared = selectHallEntry(withSelection, null);
    expect(cleared.selectedHallEntryId).toBeNull();
  });

  it("caps the hall of fame to 50 entries", () => {
    let state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    for (let index = 0; index < 60; index += 1) {
      state = addHallOfFameEntry(state, {
        id: `hall-${index}`,
        runId: "preview",
        dna: "AAA",
        name: `Entry ${index}`,
        score: index,
        terrainName: "Flat",
        generation: 0,
        savedAt: "2024-01-01T00:00:00.000Z",
        notes: "",
      });
    }

    expect(state.hallOfFame.entries).toHaveLength(50);
    expect(state.hallOfFame.entries[0]?.id).toBe("hall-59");
    expect(state.hallOfFame.entries[49]?.id).toBe("hall-10");
  });

  it("replaces hall of fame when set wholesale", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const hall = {
      version: 1 as const,
      entries: [
        {
          id: "loaded-1",
          runId: "loaded-run",
          dna: "BBB",
          name: "Imported",
          score: 500,
          terrainName: "Ice" as const,
          generation: 10,
          savedAt: "2024-02-01T00:00:00.000Z",
          notes: "",
        },
      ],
    };

    const loaded = setHallOfFame(state, hall);
    expect(loaded.hallOfFame.entries).toHaveLength(1);
    expect(loaded.hallOfFame.entries[0]?.name).toBe("Imported");
  });

  it("updates run config and clears evaluated state when config changes", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );
    const runnableState = {
      ...state.runState,
      population: [
        { id: "preview-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "preview-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "preview-00001": [],
        "preview-00002": [],
      },
    };
    const generation = runEvolutionGeneration(runnableState);
    const nextState = advanceRunState(runnableState, generation);
    const evaluated = applyGenerationToState(state, generation, nextState);

    const reconfigured = setRunConfig(evaluated, { populationSize: 50, dnaLength: 16 });
    expect(reconfigured.runState.config.populationSize).toBe(50);
    expect(reconfigured.runState.config.dnaLength).toBe(16);
    expect(reconfigured.runState.config.mutationRate).toBe(evaluated.runState.config.mutationRate);
    expect(reconfigured.latestGeneration).toBeNull();
    expect(reconfigured.lastEvaluatedRunState).toBeNull();
    expect(reconfigured.statusMessage).toContain("Run config updated");
  });

  it("renames a hall of fame entry and spends a credit", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const entry: HallOfFameEntry = {
      id: "hall-1",
      runId: "preview",
      dna: "A3x9K2m7P4zQ",
      name: "Old name",
      score: 200,
      terrainName: "Flat",
      generation: 3,
      savedAt: "2024-01-01T00:00:00.000Z",
      notes: "",
    };

    const seeded = addHallOfFameEntry(state, entry);
    const funded = {
      ...seeded,
      runState: { ...seeded.runState, wallet: 5 },
    };

    const result = renameHallOfFameEntry(funded, "hall-1", "Glider");
    expect(result.ok).toBe(true);
    expect(result.state.hallOfFame.entries[0]?.name).toBe("Glider");
    expect(result.state.runState.wallet).toBe(4);
  });

  it("rejects rename with empty name", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const entry: HallOfFameEntry = {
      id: "hall-1",
      runId: "preview",
      dna: "A3x9K2m7P4zQ",
      name: "Original",
      score: 200,
      terrainName: "Flat",
      generation: 3,
      savedAt: "2024-01-01T00:00:00.000Z",
      notes: "",
    };

    const seeded = addHallOfFameEntry(state, entry);
    const result = renameHallOfFameEntry(seeded, "hall-1", "  ");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("rejects rename when wallet has no credits", () => {
    const state = createRendererState(
      createEmptyRunState("evolution", VROOMON_PARITY_CONTRACT.terrains[0]!.name, "preview"),
      "A3x9K2m7P4zQ",
    );

    const entry: HallOfFameEntry = {
      id: "hall-1",
      runId: "preview",
      dna: "A3x9K2m7P4zQ",
      name: "Original",
      score: 200,
      terrainName: "Flat",
      generation: 3,
      savedAt: "2024-01-01T00:00:00.000Z",
      notes: "",
    };

    const seeded = addHallOfFameEntry(state, entry);
    const result = renameHallOfFameEntry(seeded, "hall-1", "New name");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("credit");
    expect(result.state.runState.wallet).toBe(0);
  });
});
