import { describe, expect, it } from "vitest";

import { createRandomDna, decodeDnaV2 } from "../src/shared/dna-v2.js";
import {
  createMatterVehicle,
  snapshotMatterVehicle,
  stepMatterVehicle,
  type MatterVehicle,
  type VehicleSnapshot,
} from "../src/simulation/matter-simulation.js";

// 10 seconds at 60 FPS: comfortably longer than any race window, and still
// inside the 5000px track (a car that runs off the end is not disintegrating).
const STEPS_FOR_10S = 600;
const PROGRESS_MIN_X = 100;
const MAX_PIECE_DISTANCE = 250;

function measureSpread(snapshot: VehicleSnapshot): { max: number; avg: number } {
  const pieces = [...snapshot.chassis, ...snapshot.wheels];
  if (pieces.length === 0) return { max: 0, avg: 0 };

  let max = 0;
  let total = 0;

  for (const piece of pieces) {
    const dx = piece.x - snapshot.centerX;
    const dy = piece.y - snapshot.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > max) max = distance;
    total += distance;
  }

  return { max, avg: total / pieces.length };
}

function driveAndSnapshot(vehicle: MatterVehicle): VehicleSnapshot {
  return stepMatterVehicle(vehicle, STEPS_FOR_10S);
}

function deepestPiece(snapshot: VehicleSnapshot): number {
  return Math.max(...[...snapshot.chassis, ...snapshot.wheels].map((piece) => piece.y));
}

describe("single-car drive integrity", () => {
  it("drives a well-formed car without falling apart", () => {
    // Plates + two wheels with cylinders upstream: a car that works.
    const dna = "fq4j7dJgZAic";
    const vehicle = createMatterVehicle(dna, "Flat");
    const start = snapshotMatterVehicle(vehicle);

    const startSpread = measureSpread(start);
    expect(startSpread.max).toBeLessThan(MAX_PIECE_DISTANCE);
    expect(vehicle.chassisBodies).toHaveLength(1);
    expect(vehicle.wheelBodies.length).toBeGreaterThanOrEqual(2);
    expect(vehicle.driveScale).toBeGreaterThan(0);

    const end = driveAndSnapshot(vehicle);

    // Forward progress, and the pieces are still a car rather than a debris
    // field: one rigid body means they cannot drift apart at all.
    expect(end.centerX - start.centerX).toBeGreaterThan(PROGRESS_MIN_X);
    const endSpread = measureSpread(end);
    expect(endSpread.max).toBeLessThan(MAX_PIECE_DISTANCE);

    // Still above the ground and still real numbers.
    expect(deepestPiece(end)).toBeLessThan(400);
    for (const piece of [...end.chassis, ...end.wheels]) {
      expect(Number.isFinite(piece.x)).toBe(true);
      expect(Number.isFinite(piece.y)).toBe(true);
      expect(Number.isFinite(piece.angle)).toBe(true);
    }
  });

  it("keeps every part of a 4-wheel car together", () => {
    // A known four-wheel car: RRWWWW / CGCGDC, with all four wheels driven.
    const dna = "PNEexlimSimR";
    const vehicle = createMatterVehicle(dna, "Flat");
    const start = snapshotMatterVehicle(vehicle);
    const initialChassisCount = start.chassis.length;
    const initialWheelCount = start.wheels.length;

    expect(initialChassisCount).toBeGreaterThan(0);
    expect(initialWheelCount).toBe(4);
    // One rigid body: no joints to hold together, so nothing to come apart.
    expect(vehicle.chassisBodies).toHaveLength(1);
    expect(vehicle.constraints).toHaveLength(0);

    const end = driveAndSnapshot(vehicle);

    expect(end.chassis.length).toBe(initialChassisCount);
    expect(end.wheels.length).toBe(initialWheelCount);
    expect(end.centerX).toBeGreaterThan(start.centerX);
    expect(measureSpread(end).max).toBeLessThan(MAX_PIECE_DISTANCE);
    expect(deepestPiece(end)).toBeLessThan(400);
  });

  it("does not move a car whose power path reaches no wheel", () => {
    // The design's bargain: a wheel with no cylinder upstream is dead weight,
    // and a frame full of dead wheels goes nowhere.
    let seed = 5;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let dna = "";
    for (let index = 0; index < 4000 && dna === ""; index += 1) {
      const candidate = createRandomDna(8, rand);
      const decoded = decodeDnaV2(candidate);
      if (!decoded.modules.includes("W")) {
        continue;
      }
      const vehicle = createMatterVehicle(candidate, "Flat");
      if (vehicle.driveScale === 0) {
        dna = candidate;
      }
    }

    expect(dna).not.toBe("");
    const vehicle = createMatterVehicle(dna, "Flat");
    const start = snapshotMatterVehicle(vehicle);
    const end = driveAndSnapshot(vehicle);

    // A dud is a dud: no drive, no crawling, and still on the ground.
    expect(Math.abs(end.centerX - start.centerX)).toBeLessThan(60);
    expect(deepestPiece(end)).toBeLessThan(400);
  });

  it("finds a minority of competitive cars in random DNA, and no launchers", () => {
    // The design's bargain again, from the other side: most combinations are
    // not competitive, but there is real signal to breed on — and a dud never
    // turns into a rocket.
    let seed = 99;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const sampled = 60;
    let moves = 0;
    let competitive = 0;
    let launched = 0;
    let best = 0;

    for (let index = 0; index < sampled; index += 1) {
      const dna = createRandomDna(12, rand);
      const vehicle = createMatterVehicle(dna, "Flat");
      const start = snapshotMatterVehicle(vehicle);
      const end = stepMatterVehicle(vehicle, 180);
      const progress = end.centerX - start.centerX;
      if (progress > 60) moves += 1;
      if (progress > 300) competitive += 1;
      best = Math.max(best, progress);
      const highest = Math.min(...[...end.chassis, ...end.wheels].map((p) => p.y));
      if (highest < -300) launched += 1;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[drive] random sample: ${moves}/${sampled} move, ${competitive}/${sampled} competitive, best=${best.toFixed(0)}px`,
    );

    expect(launched).toBe(0);
    expect(moves).toBeGreaterThan(0);
    expect(competitive).toBeLessThan(moves);
    expect(best).toBeGreaterThan(300);
  });
});
