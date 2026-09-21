// Campaign pacing: the circuit has to stay winnable on the ground it sits on.
//
// An evolution game's balance cannot be reasoned about, only measured — what
// a herd can do depends on the simulation of that terrain, not on what the
// numbers looked like in a spreadsheet. This file guards the relationship
// that matters:
//
//   a tier V bar must sit UNDER the ceiling its own terrain allows a herd
//
// At the old growth of 1.28 the Quarry's tier V asked 2,094 against a Quarry
// ceiling of 2,068 — a player could sweep that circuit forever and never take
// the tier. Nothing caught it because nothing measured it.
//
// The ceilings below are recorded measurements (see `measureCeilings`), kept
// here so the suite stays fast: the fast test checks the bars against them,
// and setting VROOMON_SLOW_TESTS=1 re-measures for real.

import { describe, expect, it } from "vitest";
import { advanceRunState, createPreviewRunState, runEvolutionGeneration } from "../src/core/population.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";
import { feudBar } from "../src/renderer/circuit.js";

const TERRAINS = ["Grassland", "Sand", "Hills", "Rocky", "Ice"] as const;

/**
 * The best each ground has DEMONSTRABLY produced: 60 cars, 120 generations,
 * mutation 0.3, best of the last ten, and the maximum across the seeds tried.
 *
 * Worth knowing before reading these numbers as "the ceiling": the variance
 * between seeds is larger than the variance between terrains. Two runs of the
 * same recipe gave Sand 3,141 then 1,673, and Rocky 2,068 then 3,224 — the
 * starting population decides far more than the dirt does. So the guard below
 * is deliberately the WEAK claim (a bar must sit under what the ground has
 * produced at least once) rather than a strong one (a bar must sit under what
 * any run produces), which would be untrue and would fail on noise.
 *
 * A bar above a particular seed's result is not a dead end either: the herd
 * keeps breeding, and every generation can find a better car. It is a grind,
 * which is why the growth came down from 1.28 to 1.22 — measured, tier V
 * arrived by generation 38 at the worst, rather than never.
 */
const BEST_OBSERVED: Record<string, number> = {
  Grassland: 2507,
  Sand: 3141,
  Hills: 3199,
  Rocky: 3224,
  Ice: 3534,
};

function mulberry(seed: string): () => number {
  let state = 0;
  for (const char of seed) {
    state = (state * 31 + char.charCodeAt(0)) % 4294967296;
  }
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Measure a ceiling for real. Slow: minutes, not milliseconds. */
function measureCeilings(
  generations: number,
  size: number,
  seedTag = "",
): Record<string, number> {
  const ceilings: Record<string, number> = {};
  for (const terrain of TERRAINS) {
    const base = createEmptyRunState("pacing");
    const configured = {
      ...base,
      terrainName: terrain,
      config: { ...base.config, populationSize: size, mutationRate: 0.3 },
    };
    const seed = `pace-${terrain}${seedTag}`;
    let state = createPreviewRunState(seed, configured, mulberry(seed));
    const trajectory: number[] = [];
    for (let generation = 1; generation <= generations; generation += 1) {
      const result = runEvolutionGeneration(state, mulberry(`${seed}-${generation}`));
      trajectory.push(Math.max(0, ...result.evaluation.results.map((entry) => entry.score)));
      state = advanceRunState(state, result);
    }
    ceilings[terrain] = Math.max(...trajectory.slice(-10));
  }
  return ceilings;
}

describe("campaign pacing", () => {
  it("keeps every tier V bar under what its ground has produced", () => {
    for (const terrain of TERRAINS) {
      const ceiling = BEST_OBSERVED[terrain]!;
      const bar = feudBar(terrain, 5);
      expect(
        bar,
        `${terrain}: tier V asks ${bar} against the best this ground has produced (${ceiling})`,
      ).toBeLessThan(ceiling * 0.95);
    }
  });

  it("rises across the campaign without a cliff", () => {
    const bars = TERRAINS.map((terrain) => feudBar(terrain, 1));
    // The ladder climbs: the Perimeter's opening ask is above the Grassland's.
    for (let index = 1; index < bars.length; index += 1) {
      expect(bars[index]!).toBeGreaterThanOrEqual(bars[index - 1]!);
    }
    // And no step is a wall: each next circuit opens within 1.5x of the last.
    for (let index = 1; index < bars.length; index += 1) {
      expect(bars[index]! / bars[index - 1]!).toBeLessThan(1.5);
    }
  });

  it("keeps a sweep meaningfully harder than the one before", () => {
    for (const terrain of TERRAINS) {
      expect(feudBar(terrain, 5)).toBeGreaterThan(feudBar(terrain, 1) * 1.5);
    }
  });

  it.skipIf(!process.env.VROOMON_SLOW_TESTS)(
    "re-measures the ceilings (VROOMON_SLOW_TESTS=1)",
    () => {
      // Two seeds per terrain: the best of them is the honest ceiling, since
      // the seed's starting population matters more than the ground does.
      const first = measureCeilings(60, 60, "a");
      const second = measureCeilings(60, 60, "b");
      const best: Record<string, number> = {};
      for (const terrain of TERRAINS) {
        best[terrain] = Math.max(first[terrain] ?? 0, second[terrain] ?? 0);
      }
      // eslint-disable-next-line no-console
      console.log(
        "[pacing] ceilings: seed A",
        JSON.stringify(first),
        "seed B",
        JSON.stringify(second),
      );
      for (const terrain of TERRAINS) {
        expect(
          feudBar(terrain, 5),
          `${terrain}: tier V asks ${feudBar(terrain, 5)} against a best of ${best[terrain]}`,
        ).toBeLessThan(best[terrain]! * 0.95);
      }
    },
    900_000,
  );
});
