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
import { advanceRunState, createPreviewRunState, runEvolutionGeneration } from "../../src/core/population.js";
import { createEmptyRunState } from "../../src/shared/parity-contract.js";
import { feudBar } from "../../src/renderer/circuit.js";

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
  it("asks more of tier I than a random herd already does", () => {
    // A Brand that falls to the starting population is not a Brand. These are
    // the first-generation bests measured for a 32-car herd per terrain; the
    // ladder has to start above them.
    const randomHerdBest: Record<string, number> = {
      Grassland: 750,
      Sand: 1145,
      Hills: 1097,
      Rocky: 1052,
      Ice: 875,
    };
    for (const terrain of TERRAINS) {
      expect(
        feudBar(terrain, 1),
        `${terrain}: tier I (${feudBar(terrain, 1)}) is under what a random herd does (${randomHerdBest[terrain]})`,
      ).toBeGreaterThan(randomHerdBest[terrain]!);
    }
  });

  it("keeps the campaign's own requirement under what each ground produces", () => {
    // The campaign needs tier I on each biome for its Brand. That has to be
    // comfortably reachable, which is the check that matters most: the tiers
    // above it are a title defence, not a gate.
    for (const terrain of TERRAINS) {
      const ceiling = BEST_OBSERVED[terrain]!;
      expect(
        feudBar(terrain, 1),
        `${terrain}: the Brand asks ${feudBar(terrain, 1)} against ${ceiling}`,
      ).toBeLessThan(ceiling * 0.8);
    }
  });

  it("has no cliff between one circuit and the next", () => {
    // The bars are set per ground, so they do NOT climb in lockstep with the
    // campaign order — a car that is quick on the Ice is slow on the
    // Grassland, and pretending otherwise is what made the old flat ladder
    // unfair. What matters is that no step is a wall.
    const bars = TERRAINS.map((terrain) => feudBar(terrain, 1));
    for (let index = 1; index < bars.length; index += 1) {
      expect(bars[index]! / bars[index - 1]!).toBeLessThan(1.6);
      expect(bars[index - 1]! / bars[index]!).toBeLessThan(1.6);
    }
    // And the whole range is sane: the hardest opening circuit is not many
    // times the easiest.
    expect(Math.max(...bars) / Math.min(...bars)).toBeLessThan(2);
  });

  it("keeps a sweep meaningfully harder than the one before", () => {
    for (const terrain of TERRAINS) {
      expect(feudBar(terrain, 5)).toBeGreaterThan(feudBar(terrain, 1) * 1.5);
    }
  });

  it("takes a real arc to win five Brands", () => {
    // A bot rancher with one policy: run generations on each biome until its
    // circuit bar falls, then move on. This is the campaign spine, and at the
    // old bars it took six generations — thirty seconds of play.
    const order: Array<[string, string]> = [
      ["gym_1", "Grassland"],
      ["gym_2", "Sand"],
      ["hills_map", "Hills"],
      ["rocky_map", "Rocky"],
      ["ice_map", "Ice"],
    ];
    let total = 0;
    const perBiome: number[] = [];

    for (const [mapId, terrain] of order) {
      const base = createEmptyRunState("campaign");
      const configured = {
        ...base,
        terrainName: terrain,
        config: { ...base.config, populationSize: 32, mutationRate: 0.3 },
      };
      const seed = `pacing-campaign-${mapId}`;
      let state = createPreviewRunState(seed, configured, mulberry(seed));
      const bar = feudBar(terrain, 1);
      let generations = 0;
      let best = 0;
      while (best < bar && generations < 60) {
        const result = runEvolutionGeneration(state, mulberry(`${seed}-${generations}`));
        best = Math.max(0, ...result.evaluation.results.map((entry) => entry.score));
        state = advanceRunState(state, result);
        generations += 1;
      }
      expect(best, `${terrain}: never reached ${bar} (best ${Math.round(best)})`).toBeGreaterThanOrEqual(bar);
      expect(generations, `${terrain}: the Brand fell in ${generations} generations`).toBeGreaterThanOrEqual(1);
      perBiome.push(generations);
      total += generations;
    }

    // eslint-disable-next-line no-console
    console.log("[pacing] Brands took:", perBiome.join(" / "), "generations");
    // An evening of breeding, not thirty seconds and not a week.
    expect(total).toBeGreaterThanOrEqual(8);
    expect(total).toBeLessThanOrEqual(150);
  }, 600_000);

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
