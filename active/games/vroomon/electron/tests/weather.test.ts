import { describe, expect, it } from "vitest";
import { isWet, weatherAt, weatherOf } from "../src/renderer/world/weather.js";
import { createMatterVehicle, snapshotMatterVehicle, stepMatterVehicle } from "../src/simulation/matter-simulation.js";

function travel(dna: string, terrain: string, grip = 1, drive = 1): number {
  const vehicle = createMatterVehicle(dna, terrain, { grip, drive });
  const start = snapshotMatterVehicle(vehicle);
  const end = stepMatterVehicle(vehicle, 180);
  return end.centerX - start.centerX;
}

describe("weather", () => {
  it("cycles with the same day the rest of the world uses", () => {
    const seen = [0.05, 0.25, 0.5, 0.7, 0.9].map((phase) => weatherAt(0, phase).kind);
    // Dawn and morning are clear; then it turns.
    expect(seen[0]).toBe("clear");
    expect(seen[1]).toBe("clear");
    expect(seen[2]).toBe("shower");
    expect(seen[3]).toBe("gale");
    expect(seen[4]).toBe("mist");
    // Same phase, same sky: weather is not a dice roll per race.
    expect(weatherAt(1000, 0.35).kind).toBe(weatherAt(99999, 0.35).kind);
  });

  it("keeps dry weather neutral and wet weather costly", () => {
    const clear = weatherOf("clear");
    expect(clear.grip).toBe(1);
    expect(clear.drive).toBe(1);
    expect(isWet(clear)).toBe(false);
    for (const kind of ["shower", "gale", "mist"] as const) {
      const weather = weatherOf(kind);
      expect(isWet(weather)).toBe(true);
      expect(weather.grip).toBeGreaterThan(0.5);
      expect(weather.grip).toBeLessThan(1);
      expect(weather.note.length).toBeGreaterThan(10);
    }
  });

  it("makes a race slower and can change who wins", () => {
    // Two good cars. In the dry one is quicker; in the wet, the one with
    // drive on both wheels holds its grip better, which is the point of
    // weather at all.
    const twoWheel = "Lhn4yi8zKRd2";
    const threeWheel = "RuAp2owjBaqK";

    const dryA = travel(twoWheel, "Flat");
    const dryB = travel(threeWheel, "Flat");
    const wetA = travel(twoWheel, "Flat", weatherOf("shower").grip, weatherOf("shower").drive);
    const wetB = travel(threeWheel, "Flat", weatherOf("shower").grip, weatherOf("shower").drive);

    // Both cars are slower in the wet than they were in the dry.
    expect(wetA).toBeLessThan(dryA);
    expect(wetB).toBeLessThan(dryB);

    // And the gap between them moves: weather is not a uniform tax.
    expect(Math.abs(wetA - wetB)).not.toBeCloseTo(Math.abs(dryA - dryB), 0);
  });

  it("leaves a car that cannot drive unable to drive", () => {
    const dud = "000000000000";
    expect(travel(dud, "Flat", 0.72, 0.94)).toBeLessThan(60);
  });
});
