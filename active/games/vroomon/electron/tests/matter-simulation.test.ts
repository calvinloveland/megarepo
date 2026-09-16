import { describe, expect, it } from "vitest";

import { createRandomDna, decodeDnaV2 } from "../src/shared/dna-v2.js";
import { getTerrainPreset } from "../src/shared/parity-contract.js";
import {
  createMatterVehicle,
  simulatePopulationRace,
  snapshotMatterVehicle,
  stepMatterVehicle,
} from "../src/simulation/matter-simulation.js";

describe("matter physics spike", () => {
  it("builds a vehicle and terrain from DNA without non-finite bodies", () => {
    const vehicle = createMatterVehicle("A3x9K2m7P4zQ", "Grassland");
    const snapshot = snapshotMatterVehicle(vehicle);

    expect(vehicle.terrainBodies.length).toBeGreaterThan(0);
    expect(vehicle.chassisBodies.length + vehicle.wheelBodies.length).toBeGreaterThan(0);
    expect(Number.isFinite(snapshot.centerX)).toBe(true);
    expect(Number.isFinite(snapshot.centerY)).toBe(true);
  });

  it("steps the simulation and keeps all body coordinates finite", () => {
    const vehicle = createMatterVehicle("A3x9K2m7P4zQ", "Flat");
    const snapshot = stepMatterVehicle(vehicle, 120);

    for (const body of [...snapshot.chassis, ...snapshot.wheels]) {
      expect(Number.isFinite(body.x)).toBe(true);
      expect(Number.isFinite(body.y)).toBe(true);
      expect(Number.isFinite(body.angle)).toBe(true);
    }
  });

  it("can simulate a no-collision population race with forward progress", () => {
    const results = simulatePopulationRace(
      [
        { id: "car-1", dna: "A3x9K2m7P4zQ" },
        { id: "car-2", dna: "zzYY1199ABcd" },
      ],
      "Flat",
      { stepCount: 180 },
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.centerX).toBeGreaterThan(results[0]?.initialCenterX ?? 0);
    expect(results[1]?.centerX).toBeGreaterThan(results[1]?.initialCenterX ?? 0);
  });

  it("lets a well-formed two-wheel car reach the end of a flat track", () => {
    // The vroomon design is a chain: plates for structure, wheels pinned to
    // them, and a power path of cylinders/shafts/gears that has to deliver
    // drive to a wheel. "fq4j7dJgZAic" decodes to plates-then-wheels with
    // cylinders ahead of them (RRWRWR / CCGGDC) — a car that works. Most
    // DNA doesn't, which is the point.
    const dna = "fq4j7dJgZAic";
    const decoded = decodeDnaV2(dna);
    const flatTerrain = getTerrainPreset("Flat");
    const vehicle = createMatterVehicle(dna, "Flat");
    const snapshot = stepMatterVehicle(vehicle, 30_000);

    expect(decoded.wheelParams.filter(Boolean)).toHaveLength(2);
    expect(flatTerrain).toBeDefined();
    expect(snapshot.centerX).toBeGreaterThanOrEqual(flatTerrain?.groundLength ?? 0);
  });
});


describe("the structure rules", () => {
  // Deterministic search for the shapes the design talks about (a 4-part DNA
  // makes all-wheel / all-plate bodies findable).
  const findShape = (predicate: (modules: string) => boolean): string => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 3000; i += 1) {
      const dna = createRandomDna(4, rand);
      if (predicate(decodeDnaV2(dna).modules.join(""))) {
        return dna;
      }
    }
    throw new Error("no matching shape found");
  };

  it("gives a body of nothing but wheels no drive at all", () => {
    // "A wheel wheel wheel doesn't have any of the structure to go anywhere."
    const dna = findShape((modules) => !modules.includes("R"));
    const vehicle = createMatterVehicle(dna, "Flat");
    expect(vehicle.wheelBodies.length).toBeGreaterThan(0);
    // The wheels are one body, but there is no frame for the power to push
    // against, so nothing is driven.
    expect(vehicle.driveScale).toBe(0);
    expect(vehicle.wheelDriveBodies.every((drive) => drive.power === 0)).toBe(true);
    const start = snapshotMatterVehicle(vehicle);
    const end = stepMatterVehicle(vehicle, 900);
    expect(Math.abs(end.centerX - start.centerX)).toBeLessThan(60);
  });

  it("does not move a body of nothing but plates", () => {
    const dna = findShape((modules) => !modules.includes("W"));
    const vehicle = createMatterVehicle(dna, "Flat");
    expect(vehicle.wheelBodies).toHaveLength(0);
    expect(vehicle.chassisBodies.length).toBeGreaterThan(0);
    const start = snapshotMatterVehicle(vehicle);
    const end = stepMatterVehicle(vehicle, 900);
    expect(Math.abs(end.centerX - start.centerX)).toBeLessThan(30);
  });
});
