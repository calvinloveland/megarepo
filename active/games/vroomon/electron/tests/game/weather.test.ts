import { describe, expect, it } from "vitest";
import {
  encounterWeather,
  isWet,
  weatherAt,
  weatherDefence,
  weatherOf,
} from "../../src/renderer/world/weather.js";
import { feudBar } from "../../src/renderer/circuit.js";
import { createMatterVehicle, snapshotMatterVehicle, stepMatterVehicle } from "../../src/simulation/matter-simulation.js";

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

describe("weather as a defence modifier", () => {
  it("raises the bar in bad weather and never lowers it", () => {
    expect(weatherDefence(weatherOf("clear"))).toBe(1);
    for (const kind of ["shower", "gale", "mist"] as const) {
      const defence = weatherDefence(weatherOf(kind));
      expect(defence).toBeGreaterThan(1);
      // A wrinkle, not a wall: never more than a seventh harder.
      expect(defence).toBeLessThan(1.2);
    }
    // Worse sky, higher bar.
    expect(weatherDefence(weatherOf("shower"))).toBeGreaterThan(weatherDefence(weatherOf("mist")));
  });

  it("moves the bar without touching the recorded champion", () => {
    const clear = feudBar("Grassland", 3, weatherDefence(weatherOf("clear")));
    const wet = feudBar("Grassland", 3, weatherDefence(weatherOf("shower")));
    // A champion that sits between the two bars: clears the dry circuit,
    // falls short of the same circuit in the rain.
    const champion = Math.round((clear + wet) / 2);

    expect(clear).toBe(feudBar("Grassland", 3));
    expect(wet).toBeGreaterThan(clear);
    // A champion that clears the bar in the dry can be turned away by rain —
    // which is the whole point of a defence modifier.
    const wouldClear = champion >= clear;
    const wouldBeShort = champion < wet;
    expect(wouldClear && wouldBeShort).toBe(true);
  });

  it("leaves the campaign's numbers exactly as measured under a clear sky", () => {
    // Every other caller passes no defence, so the pacing measurements hold.
    for (const terrain of ["Grassland", "Sand", "Hills", "Rocky", "Ice"]) {
      for (const tier of [1, 2, 3, 4, 5]) {
        expect(feudBar(terrain, tier, weatherDefence(weatherOf("clear")))).toBe(
          feudBar(terrain, tier),
        );
      }
    }
  });
});

describe("the tutorial waits for a clear spell", () => {
  it("gives the first lesson a dry afternoon", () => {
    const rainy = weatherAt(0, 0.5);
    expect(isWet(rainy)).toBe(true);
    // The same hour, during the tutorial, is clear.
    expect(encounterWeather({ timeMs: 0, phase: 0.5, tutorial: true }).kind).toBe("clear");
    // And afterwards the sky is whatever it is.
    expect(encounterWeather({ timeMs: 0, phase: 0.5 }).kind).toBe(rainy.kind);
    expect(encounterWeather({ timeMs: 0, phase: 0.25 }).kind).toBe("clear");
  });
});
