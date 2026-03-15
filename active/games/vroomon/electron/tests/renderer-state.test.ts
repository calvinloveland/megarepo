import { describe, expect, it } from "vitest";

import { runEvolutionGeneration } from "../src/core/population.js";
import { VROOMON_PARITY_CONTRACT } from "../src/shared/parity-contract.js";
import {
  applyGenerationToState,
  createRendererState,
  getSelectedVehicleSummary,
  selectVehicle,
  setRendererMode,
  setRendererTerrain,
} from "../src/renderer/state.js";

describe("renderer state", () => {
  it("switches between menu and app modes", () => {
    const state = createRendererState(VROOMON_PARITY_CONTRACT, "A3x9K2m7P4zQ");

    expect(setRendererMode(state, "test-drive").mode).toBe("test-drive");
    expect(setRendererMode(state, "evolution").mode).toBe("evolution");
  });

  it("tracks terrain changes in the run state", () => {
    const state = createRendererState(VROOMON_PARITY_CONTRACT, "A3x9K2m7P4zQ");

    expect(setRendererTerrain(state, "Flat").runState.terrainName).toBe("Flat");
  });

  it("selects the best vehicle after a generation is applied", () => {
    const state = createRendererState(VROOMON_PARITY_CONTRACT, "A3x9K2m7P4zQ");
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

    const nextState = applyGenerationToState(state, generation);

    expect(nextState.latestGeneration).not.toBeNull();
    expect(nextState.selectedVehicleId).toBeTruthy();
    expect(nextState.runState.generation).toBe(1);
  });

  it("returns selected vehicle summaries for the sidebar", () => {
    const state = createRendererState(VROOMON_PARITY_CONTRACT, "A3x9K2m7P4zQ");
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
      applyGenerationToState(state, generation),
      generation.evaluatedPopulation[0]!.id,
    );

    expect(getSelectedVehicleSummary(nextState)).toMatchObject({
      id: generation.evaluatedPopulation[0]!.id,
    });
  });
});
