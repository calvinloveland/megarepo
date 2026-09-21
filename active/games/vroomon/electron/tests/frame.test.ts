import { describe, expect, it } from "vitest";
import { decodeDnaV2 } from "../src/shared/dna-v2.js";
import { drivenWheels, frameGeometry, framePlant } from "../src/shared/frame.js";
import { createPreviewRunState } from "../src/core/population.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";
import { SIM_TUNING } from "../src/simulation/matter-simulation.js";

/** The weights the sim actually plants a frame with. */
const WEIGHTS = { tiltCost: SIM_TUNING.tiltCost, hullCost: SIM_TUNING.hullCost };

/** Deterministic noise, so the herd this test inspects is the same every run. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The frame is the part of a vroomon you can see: plates, wheels pinned at
// their centres, and what the body's shape costs. The sim and the blueprint
// both read these numbers, so they are worth pinning directly rather than only
// through the blueprints built on top of them.

const WELL_FORMED = "RuAp2owjBaqK";

describe("frame geometry", () => {
  it("counts what the chain actually contains", () => {
    const decoded = decodeDnaV2(WELL_FORMED);
    const geometry = frameGeometry(decoded);
    expect(geometry.plates).toBeGreaterThan(0);
    expect(geometry.wheels).toBeGreaterThan(0);
    expect(geometry.plates + geometry.wheels).toBe(decoded.modules.length);
    expect(geometry.drivenWheels).toBeGreaterThan(0);
    expect(geometry.drivenWheels).toBeLessThanOrEqual(geometry.wheels);
  });

  it("reports the tilt the plates actually have", () => {
    const geometry = frameGeometry(decodeDnaV2(WELL_FORMED));
    expect(Number.isFinite(geometry.tiltDegrees)).toBe(true);
    expect(geometry.tiltDegrees).toBeGreaterThanOrEqual(0);
    expect(geometry.biggestWheel).toBeGreaterThan(0);
  });

  it("keeps every cost in range, so nothing can be worth less than nothing", () => {
    // tiltCost, hullCost, traction and driveScale are all multipliers or
    // fractions: a frame that drags should read toward 0, never below it.
    for (const dna of [WELL_FORMED, "vcG5pzmORWqC", "Lhn4yi8zKRd2"]) {
      const plant = framePlant(decodeDnaV2(dna), WEIGHTS);
      expect(plant.tiltCost).toBeGreaterThanOrEqual(0);
      expect(plant.tiltCost).toBeLessThanOrEqual(1);
      expect(plant.hullCost).toBeGreaterThanOrEqual(0);
      // hullCost is a drag multiplier and is deliberately allowed past 1.
      expect(plant.hullCost).toBeLessThanOrEqual(1.5);
      expect(plant.traction).toBeGreaterThanOrEqual(0);
      expect(plant.traction).toBeLessThanOrEqual(1);
      expect(plant.driveScale).toBeGreaterThanOrEqual(0);
      expect(plant.driveScale).toBeLessThanOrEqual(1);
      expect(plant.biggestWheel).toBeGreaterThan(0);
    }
  });

  it("drives only the wheels the power path reaches, best first", () => {
    const decoded = decodeDnaV2(WELL_FORMED);
    const driven = drivenWheels(decoded);
    expect(driven.length).toBeGreaterThan(0);
    for (let index = 1; index < driven.length; index += 1) {
      expect(driven[index - 1]!.power).toBeGreaterThanOrEqual(driven[index]!.power);
    }
    for (const wheel of driven) {
      // Every entry names a real wheel slot, and it is driven at all.
      expect(decoded.modules[wheel.index]).toBe("W");
      expect(wheel.power).toBeGreaterThan(1);
      expect(wheel.torque).toBeGreaterThan(0);
    }
  });

  it("finds cars the power never reaches, in an ordinary herd", () => {
    // "An engine behind a wheel can't turn it" is the rule the pupil at the
    // schoolhouse says out loud. Rather than hand-write a DNA to prove it -
    // base62 decoding is not literal, which I learned the hard way - find one
    // in a real herd and check the frame agrees with the blueprint's verdict.
    const state = createPreviewRunState("frame", createEmptyRunState("frame"), mulberry(0x5eed));
    const undriven = state.population.filter(
      (entry) => drivenWheels(decodeDnaV2(entry.dna)).length === 0,
    );
    expect(undriven.length).toBeGreaterThan(0);
    for (const entry of undriven.slice(0, 3)) {
      const plant = framePlant(decodeDnaV2(entry.dna), WEIGHTS);
      expect(plant.traction).toBe(0);
      expect(plant.driveScale).toBe(0);
    }
  });
});
