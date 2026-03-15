import { describe, expect, it } from "vitest";

import { advanceRunState, runEvolutionGeneration } from "../src/core/population.js";
import { VROOMON_PARITY_CONTRACT } from "../src/shared/parity-contract.js";
import {
  applyGenerationToState,
  createRendererState,
  getSelectedVehicleSummary,
  selectVehicle,
  setRendererMode,
  setRendererRunState,
  setRendererTerrain,
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
});
