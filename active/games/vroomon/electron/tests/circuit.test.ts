import { describe, expect, it } from "vitest";
import {
  feudBar,
  nextCircuitTarget,
  VENUE_BADGE,
  nextTier,
  rivalScoreFor,
  terrainForVenue,
  tierLabel,
  tierOutcome,
  venueTitle,
  TIER_GROWTH,
} from "../src/renderer/circuit.js";

describe("the feud circuit", () => {
  it("names tiers in roman numerals and keeps counting past X", () => {
    expect(tierLabel(1)).toBe("I");
    expect(tierLabel(2)).toBe("II");
    expect(tierLabel(10)).toBe("X");
    expect(tierLabel(13)).toBe("#13");
    expect(tierLabel(0)).toBe("I");
  });

  it("maps arenas to the terrain they're raced on", () => {
    expect(terrainForVenue("gym_1")).toBe("Grassland");
    expect(terrainForVenue("ice_map")).toBe("Ice");
    expect(terrainForVenue("unknown")).toBe("Grassland");
  });

  it("scales the bar every sweep", () => {
    const first = feudBar("Grassland", 1);
    const second = feudBar("Grassland", 2);
    const third = feudBar("Grassland", 3);
    expect(first).toBe(1000);
    expect(second).toBe(Math.round(1000 * TIER_GROWTH));
    expect(third).toBeGreaterThan(second);
    // After five sweeps the bar has clearly outgrown a starter herd — but it
    // still has to be a bar a real herd can clear, which is what keeps the
    // circuit winnable (see tests/pacing.test.ts).
    expect(feudBar("Grassland", 5)).toBeGreaterThan(1900);
  });

  it("gives rougher ground a higher bar", () => {
    expect(feudBar("Ice", 1)).toBeGreaterThan(feudBar("Grassland", 1));
  });

  it("decides an outcome and how short the champion fell", () => {
    expect(tierOutcome(900, 600)).toEqual({ won: true, shortfall: 0 });
    expect(tierOutcome(600, 600)).toEqual({ won: true, shortfall: 0 });
    expect(tierOutcome(470, 600)).toEqual({ won: false, shortfall: 130 });
    expect(tierOutcome(Number.NaN, 600)).toEqual({ won: false, shortfall: 600 });
  });

  it("puts the rival just short of the bar", () => {
    expect(rivalScoreFor(600)).toBe(564);
    expect(rivalScoreFor(600)).toBeLessThan(600);
  });

  it("advances tiers and titles venues", () => {
    expect(nextTier(1)).toBe(2);
    expect(venueTitle("Salt Road", 2)).toBe("Salt Road II");
  });
});

describe("circuit targets", () => {
  it("prefers the arena you're standing in", () => {
    // Tiers are keyed by Brand, so one sweep raises the bar area-wide.
    const target = nextCircuitTarget("ice_map", ["Grassland Brand"], {
      "Perimeter Brand": 3,
    });
    expect(target).toMatchObject({ mapId: "ice_map", terrain: "Ice", tier: 3 });
    expect(target.bar).toBe(feudBar("Ice", 3));
  });

  it("otherwise points at the next Brand you're missing", () => {
    const target = nextCircuitTarget("starter_town", ["Grassland Brand"], {});
    expect(target.mapId).toBe("gym_2");
    expect(target.terrain).toBe("Sand");
    expect(target.tier).toBe(1);
  });

  it("falls back to the first arena once everything is swept", () => {
    const all = Object.values(VENUE_BADGE);
    expect(nextCircuitTarget("route_1", all, {}).mapId).toBe("gym_1");
  });
});

describe("a feud is named for the ground, not the doorway", () => {
  // The Greensprouts' elder can challenge you in Starter Town, but the
  // Grassland Brand is defended at Rustler Pasture. The target resolution is
  // what the renderer uses to name the race, so this is the naming contract.
  it("resolves to the arena even when accepted in town", () => {
    const target = nextCircuitTarget("starter_town", [], {});
    expect(target.mapId).toBe("gym_1");
    expect(target.terrain).toBe("Grassland");
  });

  it("resolves to the arena you are standing in", () => {
    expect(nextCircuitTarget("gym_2", [], {}).mapId).toBe("gym_2");
  });
});
