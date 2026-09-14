import { describe, expect, it } from "vitest";
import { createEmptyRunState } from "../src/shared/parity-contract.js";
import {
  advanceRunState,
  captureLineage,
  createInitialPopulation,
  plantSeedDna,
  previewEvolutionStep,
  runEvolutionGeneration,
} from "../src/core/population.js";

function makeState() {
  const state = createEmptyRunState("evolution");
  return {
    ...state,
    population: createInitialPopulation(state.runId, { ...state.config, populationSize: 10 }),
  };
}

describe("herd management core", () => {
  it("freezes mutation when a Calm Tonic is stocked, then consumes it", () => {
    const seeded = (() => {
      let n = 0;
      return () => ((n = (n * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    })();
    const mutantRandom = () => 0.02; // below default 0.1, above calm's 0
    const base = runEvolutionGeneration(makeState(), mutantRandom).nextPopulation;
    const mutated = base.filter((e) => Boolean(e.mutated)).length;

    const calmState = { ...makeState(), supplies: { calm: 1, wild: 0 } };
    const result = runEvolutionGeneration(calmState, mutantRandom);
    expect(result.nextPopulation.filter((e) => Boolean(e.mutated))).toHaveLength(0);
    expect(result.suppliesConsumed).toEqual({ calm: 1, wild: 0 });
    // sanity: without the tonic, the same dice would mutate
    expect(mutated).toBeGreaterThan(0);
  });

  it("bumps mutation for a Wild Brome cycle and consumes it once", () => {
    const neverMutate = () => 0.31; // above 0.1 default, below 0.1+0.15=0.25? no
    const state = { ...makeState(), supplies: { calm: 0, wild: 1 } };
    const result = runEvolutionGeneration(state, neverMutate);
    // 0.31 > 0.25 -> still mutates because... 0.1 + 0.15 = 0.25 < 0.31 => no mutate. Use 0.2.
    const result2 = runEvolutionGeneration(makeState(), () => 0.2);
    expect(result2.suppliesConsumed).toEqual({ calm: 0, wild: 0 });
    void result; void neverMutate;
    const state2 = { ...makeState(), supplies: { calm: 0, wild: 1 } };
    const wild = runEvolutionGeneration(state2, () => 0.2);
    expect(wild.nextPopulation.filter((e) => Boolean(e.mutated)).length).toBeGreaterThan(0);
    expect(wild.suppliesConsumed).toEqual({ calm: 0, wild: 1 });
    const consumed = advanceRunState(state2, wild);
    expect(consumed.supplies).toEqual({ calm: 0, wild: 0 });
  });

  it("advanceRunState drains supplies exactly once per cycle", () => {
    const state = { ...makeState(), supplies: { calm: 2, wild: 0 } };
    const r1 = advanceRunState(state, runEvolutionGeneration(state, () => 0.999));
    expect(r1.supplies).toEqual({ calm: 1, wild: 0 });
    const r2 = advanceRunState(r1, runEvolutionGeneration(r1, () => 0.999));
    expect(r2.supplies).toEqual({ calm: 0, wild: 0 });
  });

  it("repeats a stud-line parent far more often than random when a pen is set", () => {
    const scored = Array.from({ length: 10 }, (_, i) => ({
      id: `car-${i}`,
      dna: "G".repeat(8),
      parents: [] as string[],
      mutated: false,
      score: 10 - i,
    }));
    const studId = "car-0";
    const result = previewEvolutionStep(scored, 0.6, 0.1, "run", {}, () => 0.5, [studId]);
    const studUsage = result.breeding.parentUsage[studId] ?? 0;
    expect(studUsage).toBeGreaterThan(0);
    // With random 0.5 the stud is the first parent on (almost) every child.
    expect(studUsage).toBeGreaterThanOrEqual(result.breeding.childCount - 1);
  });
});

describe("lineage capture", () => {
  it("walks parents through to a configurable depth", () => {
    const population = [
      { id: "a", parents: [] },
      { id: "b", parents: ["a"] },
      { id: "c", parents: ["b"] },
      { id: "d", parents: ["c"] },
      { id: "e", parents: ["d"] },
    ];
    const line1 = captureLineage(population as never, "e", 2);
    expect(line1).toEqual(["d", "c"]);
    const line3 = captureLineage(population as never, "e", 4);
    expect(line3).toEqual(["d", "c", "b", "a"]);
  });

  it("returns empty for wild-born stock", () => {
    expect(captureLineage([{ id: "solo", parents: [] }] as never, "solo", 4)).toEqual([]);
  });

  it("captures both parents at each generation in order", () => {
    const population = [
      { id: "p1", parents: [] },
      { id: "p2", parents: [] },
      { id: "kid", parents: ["p1", "p2"] },
      { id: "gp1", parents: [] },
      { id: "gp2", parents: [] },
      { id: "p1a", parents: ["gp1", "gp2"] },
    ];
    const line = captureLineage(population as never, "kid", 2);
    expect(line.slice(0, 2)).toEqual(["p1", "p2"]);
  });
});

describe("plantSeedDna", () => {
  it("swaps the top seed's genome for an imported one", () => {
    const population = [
      { id: "a", dna: "AAA", parents: [], mutated: false, score: 10 },
      { id: "b", dna: "BBB", parents: [], mutated: false, score: 99 },
      { id: "c", dna: "CCC", parents: [], mutated: false, score: 5 },
    ];
    const seeded = plantSeedDna(population, "IMPORTED");
    expect(seeded.find((e) => e.id === "b")?.dna).toBe("IMPORTED");
    expect(seeded.find((e) => e.id === "a")?.dna).toBe("AAA");
  });

  it("returns empty for an empty herd", () => {
    expect(plantSeedDna([], "X")).toEqual([]);
  });
});
