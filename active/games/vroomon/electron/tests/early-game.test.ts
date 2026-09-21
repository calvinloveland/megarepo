import { describe, expect, it } from "vitest";
import {
  advanceRunState,
  createPreviewRunState,
  plantSeedDna,
  runEvolutionGeneration,
} from "../src/core/population.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";
import { feudBar } from "../src/renderer/circuit.js";

// The early game, measured from a fresh save. What Robby lends you is the top
// seed of the new herd; the question is how much breeding the first Brand
// actually asks for. Too few generations and the circuit is a formality; too
// many and a first sitting stalls before the first trophy.
//
// Measured (bar 1000): 463 -> 1118 at generation 2, then a plateau around
// 1205 - which is just under tier II's 1220. The first Brand is reachable,
// and the second one genuinely is not without better stock. Both halves of
// that are asserted below, because it is the shape of the curve, not the
// numbers, that the design depends on.

/** Deterministic noise, so the arc is the same arc every run. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARTER = "vcG5pzmORWqC";

describe("a first sitting on the Grassland", () => {
  it("reaches the tier I bar, and reports what it costs", () => {
    const random = mulberry(0x5eed);
    const base = createEmptyRunState("first-sitting");
    let state = createPreviewRunState("first-sitting", base, random);
    // What Robby lends you, planted as the top seed of the fresh herd.
    state = { ...state, population: plantSeedDna(state.population, STARTER) };

    const bar = feudBar("Grassland", 1);
    const best: number[] = [];
    let crossed = -1;
    for (let generation = 1; generation <= 20; generation += 1) {
      const result = runEvolutionGeneration(state, random);
      state = advanceRunState(state, result);
      best.push(result.evaluatedPopulation[0]!.score);
      if (crossed < 0 && result.evaluatedPopulation[0]!.score >= bar) {
        crossed = generation;
      }
    }
    console.log(
      `[early] bar ${bar} | best/gen ${best.map((n) => Math.round(n)).join(" ")} | crossed at gen ${crossed}`,
    );

    // The loaner alone does not clear it: the bar is about breeding, not
    // about the gift.
    expect(best[0]).toBeLessThan(bar);
    // ...but a first sitting gets there, with room to spare.
    expect(crossed).toBeGreaterThan(1);
    expect(crossed).toBeLessThanOrEqual(3);
  }, 120_000);

  it("never lets scoring a generation become the bottleneck", () => {
    // This measures the SCORING model, not the player's wait: the bench races
    // the herd through the same headless evaluation, and the on-screen race is
    // a playback of the result. The ranch upgrades change the herd size, so
    // the guarantee is that the arithmetic never becomes the slow part.
    const random = mulberry(0x5eed);
    let state = createPreviewRunState("timed", createEmptyRunState("timed"), random);
    state = { ...state, population: plantSeedDna(state.population, STARTER) };
    const started = Date.now();
    for (let generation = 1; generation <= 3; generation += 1) {
      state = advanceRunState(state, runEvolutionGeneration(state, random));
    }
    const perGeneration = (Date.now() - started) / 3 / 1000;
    console.log(`[early] ${perGeneration.toFixed(3)}s to score a generation`);
    // Generous: CI machines are slow, and the point is the order of magnitude.
    expect(perGeneration).toBeLessThan(5);
  }, 180_000);

  it("leaves the second Brand for better stock", () => {
    // Tier II sits just above what the loaner's line plateaus at. This is the
    // hinge of the whole circuit: the first trophy is a lesson, the second is
    // a reason to go and find genetics that are not already in the barn.
    const random = mulberry(0x5eed);
    let state = createPreviewRunState("first-sitting", createEmptyRunState("first-sitting"), random);
    state = { ...state, population: plantSeedDna(state.population, STARTER) };
    for (let generation = 1; generation <= 12; generation += 1) {
      state = advanceRunState(state, runEvolutionGeneration(state, random));
    }
    const plateau = Math.max(...state.population.map((entry) => entry.score));
    const tierTwo = feudBar("Grassland", 2);
    expect(plateau).toBeLessThan(tierTwo);
    // Nor is it a gulf: one good import closes it.
    expect(tierTwo - plateau).toBeLessThan(plateau * 0.15);
  }, 120_000);
});
