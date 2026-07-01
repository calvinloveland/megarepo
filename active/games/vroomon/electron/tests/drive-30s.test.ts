import { describe, expect, it } from "vitest";

import {
  createMatterVehicle,
  snapshotMatterVehicle,
  stepMatterVehicle,
  type MatterVehicle,
  type VehicleSnapshot,
} from "../src/simulation/matter-simulation.js";

// 30 seconds of simulated time at 60 FPS.
const STEPS_FOR_30S = 1800;
const PROGRESS_MIN_X = 100; // car should move at least this many pixels
const MAX_PIECE_DISTANCE = 250; // no piece can drift this far from center

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
  return stepMatterVehicle(vehicle, STEPS_FOR_30S);
}

describe("single-car drive integrity", () => {
  it("drives a simple two-wheel car for 30 seconds without falling apart", () => {
    // "aaaaaaaaaaaa" reliably decodes to a 2-wheel car (see existing tests).
    const dna = "aaaaaaaaaaaa";
    const vehicle = createMatterVehicle(dna, "Flat");
    const start = snapshotMatterVehicle(vehicle);

    // Sanity check before driving.
    const startSpread = measureSpread(start);
    expect(startSpread.max).toBeLessThan(MAX_PIECE_DISTANCE);
    expect(vehicle.chassisBodies.length).toBeGreaterThan(0);
    expect(vehicle.wheelBodies.length).toBeGreaterThanOrEqual(2);

    // Drive for 30 simulated seconds.
    const end = driveAndSnapshot(vehicle);

    // The car must make forward progress.
    const progress = end.centerX - start.centerX;
    expect(progress).toBeGreaterThan(PROGRESS_MIN_X);

    // The pieces must still be close to the car center.
    const endSpread = measureSpread(end);
    expect(endSpread.max).toBeLessThan(MAX_PIECE_DISTANCE);

    // The car must still be above the ground (not fallen through).
    const flat = { groundHeight: 400 };
    const lowestPiece = Math.max(
      ...end.chassis.map((c) => c.y),
      ...end.wheels.map((w) => w.y),
    );
    expect(lowestPiece).toBeLessThan(flat.groundHeight);

    // No NaN/Infinity on any piece.
    for (const piece of [...end.chassis, ...end.wheels]) {
      expect(Number.isFinite(piece.x)).toBe(true);
      expect(Number.isFinite(piece.y)).toBe(true);
      expect(Number.isFinite(piece.angle)).toBe(true);
    }
  });

  it("drives a 4-wheel chassis+wheel layout for 30 seconds without disintegrating", () => {
    // Build a 4-wheel car explicitly so we know what pieces we expect.
    const dna = "A3x9K2m7P4zQ";
    const vehicle = createMatterVehicle(dna, "Flat");
    const start = snapshotMatterVehicle(vehicle);
    const initialChassisCount = vehicle.chassisBodies.length;
    const initialWheelCount = vehicle.wheelBodies.length;
    const initialConstraints = vehicle.constraints.length;

    expect(initialChassisCount).toBeGreaterThan(0);
    expect(initialWheelCount).toBeGreaterThan(0);
    expect(initialConstraints).toBeGreaterThan(0);

    const end = driveAndSnapshot(vehicle);

    // Same body counts after the run.
    expect(end.chassis.length).toBe(initialChassisCount);
    expect(end.wheels.length).toBe(initialWheelCount);

    // Forward progress.
    expect(end.centerX).toBeGreaterThan(start.centerX);

    // All chassis and wheels are still in the same general area.
    const spread = measureSpread(end);
    expect(spread.max).toBeLessThan(MAX_PIECE_DISTANCE);

    // None of the pieces fall through the ground.
    const allY = [...end.chassis, ...end.wheels].map((p) => p.y);
    const lowest = Math.max(...allY);
    expect(lowest).toBeLessThan(500);
  });

  it("reports the actual progress and spread so we can debug regressions", () => {
    // Use a deterministic DNA so this is reproducible.
    const dna = "aaaaaaaaaaaa";
    const vehicle = createMatterVehicle(dna, "Flat");
    const start = snapshotMatterVehicle(vehicle);
    const end = driveAndSnapshot(vehicle);

    const progress = end.centerX - start.centerX;
    const spread = measureSpread(end);

    // Log for debugging — these values are also asserted below.
    // eslint-disable-next-line no-console
    console.log(
      `[drive-30s] progress=${progress.toFixed(1)}px ` +
        `max-piece-spread=${spread.max.toFixed(1)}px ` +
        `chassis=${end.chassis.length} wheels=${end.wheels.length}`,
    );

    expect(progress).toBeGreaterThan(0);
    expect(spread.max).toBeLessThan(MAX_PIECE_DISTANCE);
  });
});
