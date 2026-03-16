import { describe, expect, it } from "vitest";

import { decodeDnaV2 } from "../src/shared/dna-v2.js";
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

  it("lets a simple two-wheel car reach the end of a flat track", () => {
    const dna = "aaaaaaaaaaaa";
    const decoded = decodeDnaV2(dna);
    const flatTerrain = getTerrainPreset("Flat");
    const vehicle = createMatterVehicle(dna, "Flat");
    const snapshot = stepMatterVehicle(vehicle, 11_000);

    expect(decoded.wheelParams.filter(Boolean)).toHaveLength(2);
    expect(flatTerrain).toBeDefined();
    expect(snapshot.centerX).toBeGreaterThanOrEqual(flatTerrain?.groundLength ?? 0);
  });
});
