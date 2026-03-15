import { describe, expect, it } from "vitest";

import {
  computeScoreStats,
  createInitialPopulation,
  createPreviewRunState,
  previewEvolutionStep,
  runEvolutionGeneration,
} from "../src/core/population.js";
import { parseRunState, serializeRunState } from "../src/core/persistence.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";

function createSequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const nextValue = values[index % values.length]!;
    index += 1;
    return nextValue;
  };
}

describe("population core", () => {
  it("creates lineage-aware initial populations", () => {
    const population = createInitialPopulation(
      "preview",
      { populationSize: 3, dnaLength: 12 },
      createSequenceRandom([0.1, 0.2, 0.3, 0.4]),
    );

    expect(population).toHaveLength(3);
    expect(population[0]).toMatchObject({
      id: "preview-00001",
      parents: [],
      mutated: false,
      score: 0,
    });
  });

  it("computes score statistics using the Godot-style quartile summary", () => {
    expect(computeScoreStats([10, 20, 30, 40, 50])).toEqual({
      count: 5,
      mean: 30,
      median: 30,
      q1: 20,
      q3: 40,
      min: 10,
      max: 50,
    });
  });

  it("previews a lineage-preserving breeding step", () => {
    const population = [
      { id: "run-00001", dna: "AAAA", parents: [], mutated: false, score: 40 },
      { id: "run-00002", dna: "BBBB", parents: [], mutated: false, score: 30 },
      { id: "run-00003", dna: "CCCC", parents: [], mutated: false, score: 20 },
      { id: "run-00004", dna: "DDDD", parents: [], mutated: false, score: 10 },
    ];

    const preview = previewEvolutionStep(
      population,
      0.5,
      0.5,
      "run",
      undefined,
      createSequenceRandom([0.1, 0.9, 0.4, 0.2, 0.7, 0.3]),
    );

    expect(preview.population).toHaveLength(4);
    expect(preview.breeding.survivorCount).toBe(2);
    expect(preview.breeding.childCount).toBe(2);
    expect(preview.population[2]?.parents).toHaveLength(2);
    expect(Object.keys(preview.genealogy)).toContain("run-00005");
  });

  it("serializes and parses preview run states", () => {
    const previewState = createPreviewRunState(
      "preview",
      createEmptyRunState("evolution"),
      createSequenceRandom([0.1, 0.2, 0.3, 0.4]),
    );

    const parsed = parseRunState(serializeRunState(previewState));

    expect(parsed.population).toHaveLength(previewState.config.populationSize);
    expect(parsed.mode).toBe("evolution");
  });

  it("runs a generation with scored vehicles and next-generation lineage", () => {
    const generation = runEvolutionGeneration(
      createPreviewRunState(
        "preview",
        createEmptyRunState("evolution"),
        createSequenceRandom([0.1, 0.2, 0.3, 0.4]),
      ),
      createSequenceRandom([0.1, 0.9, 0.4, 0.2, 0.7, 0.3]),
    );

    expect(generation.evaluation.results).toHaveLength(
      generation.evaluatedPopulation.length,
    );
    expect(generation.evaluation.stats?.count).toBe(
      generation.evaluatedPopulation.length,
    );
    expect(Object.keys(generation.nextGenealogy).length).toBeGreaterThanOrEqual(
      generation.nextPopulation.length,
    );
  });
});
