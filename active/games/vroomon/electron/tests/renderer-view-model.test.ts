import { describe, expect, it } from "vitest";

import { createPreviewRunState, runEvolutionGeneration } from "../src/core/population.js";
import { VROOMON_PARITY_CONTRACT } from "../src/shared/parity-contract.js";
import { applyGenerationToState, createRendererState } from "../src/renderer/state.js";
import {
  resolveEvolutionPreviewRunState,
  resolveRunnableRunState,
} from "../src/renderer/view-model.js";

describe("renderer view model", () => {
  it("creates an evolution population when running from an empty state", () => {
    const state = createRendererState(VROOMON_PARITY_CONTRACT, "A3x9K2m7P4zQ");
    const flatState = {
      ...state,
      runState: {
        ...state.runState,
        terrainName: "Flat",
        mode: "test-drive",
      },
    };

    const resolved = resolveRunnableRunState(flatState, createPreviewRunState);

    expect(resolved.generatedPopulation).toBe(true);
    expect(resolved.runState.population).toHaveLength(
      flatState.runState.config.populationSize,
    );
    expect(resolved.runState.terrainName).toBe("Flat");
    expect(resolved.runState.mode).toBe("evolution");
  });

  it("normalizes populated runs into evolution mode before a generation starts", () => {
    const state = createRendererState(VROOMON_PARITY_CONTRACT, "A3x9K2m7P4zQ");
    const populatedState = {
      ...state,
      runState: createPreviewRunState("preview", {
        ...state.runState,
        mode: "test-drive",
      }),
    };

    const resolved = resolveRunnableRunState(populatedState, createPreviewRunState);

    expect(resolved.generatedPopulation).toBe(false);
    expect(resolved.runState.mode).toBe("evolution");
    expect(resolved.runState.population).toHaveLength(
      populatedState.runState.population.length,
    );
  });

  it("uses the last evaluated run state for evolution previews after advancing", () => {
    const state = createRendererState(VROOMON_PARITY_CONTRACT, "A3x9K2m7P4zQ");
    const runnable = resolveRunnableRunState(state, createPreviewRunState).runState;
    const generation = runEvolutionGeneration(runnable);
    const nextState = applyGenerationToState(
      {
        ...state,
        runState: runnable,
      },
      generation,
    );

    const previewState = resolveEvolutionPreviewRunState(
      nextState,
      createPreviewRunState,
    );

    expect(previewState).toEqual(runnable);
    expect(previewState.population).toEqual(runnable.population);
  });
});
