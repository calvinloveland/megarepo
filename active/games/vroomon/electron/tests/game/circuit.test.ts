import { describe, expect, it } from "vitest";
import { MAPS, getMap } from "../../src/renderer/world/maps.js";
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
  feudBriefing,
  shapeForTier,
  shapeReadout,
  shapeShortfall,
  VENUE_ORDER,
  badgeForMap,
  VENUE_TERRAIN,
} from "../../src/renderer/circuit.js";

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

describe("the briefing before a feud", () => {
  it("says how short you are, and that it is a breeding problem", () => {
    const short = feudBriefing({ terrain: "Grassland", tier: 1, bar: 1000, best: 973 });
    expect(short).toContain("Grassland I");
    expect(short).toContain("The bar is 1000");
    expect(short).toContain("your barn holds 973");
    expect(short).toContain("27 short");
    expect(short).toContain("breeding job");
  });

  it("says when the ground is yours to lose", () => {
    const ready = feudBriefing({ terrain: "Grassland", tier: 2, bar: 1220, best: 1400 });
    expect(ready).toContain("Grassland II");
    expect(ready).toContain("yours to lose");
    expect(ready).not.toContain("short");
  });

  it("says when there is nothing in the barn at all", () => {
    const none = feudBriefing({ terrain: "Hills", tier: 1, bar: 1150, best: 0 });
    expect(none).toContain("nothing in your Record Barn");
  });
});

describe("the shape the ground asks for", () => {
  const car = (wheels: number, drivenWheels: number, engines: number) => ({
    plates: 1,
    wheels,
    drivenWheels,
    engines,
  });

  it("asks nothing of a first Brand", () => {
    expect(shapeForTier(1).meets(car(1, 0, 1))).toBe(true);
    expect(shapeShortfall(car(1, 0, 1), 1)).toBeNull();
  });

  it("escalates what a car has to be made of", () => {
    // Two driven wheels, then three wheels with two driven, then four with
    // three, then four driven behind three engines.
    expect(shapeForTier(2).meets(car(2, 2, 1))).toBe(true);
    expect(shapeForTier(2).meets(car(2, 1, 1))).toBe(false);
    expect(shapeForTier(3).meets(car(3, 2, 1))).toBe(true);
    expect(shapeForTier(3).meets(car(2, 2, 1))).toBe(false);
    expect(shapeForTier(4).meets(car(4, 3, 2))).toBe(true);
    expect(shapeForTier(4).meets(car(3, 3, 2))).toBe(false);
    expect(shapeForTier(5).meets(car(4, 4, 3))).toBe(true);
    expect(shapeForTier(5).meets(car(4, 4, 2))).toBe(false);
  });

  it("says what the car is instead, when it does not fit", () => {
    const why = shapeShortfall(car(2, 1, 1), 3)!;
    expect(why).toContain("The ground wants at least three wheels, two of them driven");
    expect(why).toContain("this one has 2 wheels, 1 driven, 1 engine");
    // The tier is named by whoever prints it, so it is not repeated here.
    expect(why).not.toContain("III");
  });

  it("tells the keeper about it before the race", () => {
    const line = feudBriefing({
      terrain: "Grassland",
      tier: 3,
      bar: 1488,
      best: 1600,
      shape: car(2, 1, 1),
    });
    expect(line).toContain("Breed a car that fits the ground");
    // And names the demand even when the car is fine.
    const ready = feudBriefing({
      terrain: "Grassland",
      tier: 3,
      bar: 1488,
      best: 1600,
      shape: car(4, 4, 3),
    });
    expect(ready).toContain("yours to lose");
    expect(ready).toContain("at least three wheels, two of them driven");
  });
});

describe("one place, one name", () => {
  it("agrees with the map about what each arena is called", () => {
    // The circuit, the briefing and the badge line all print the venue's
    // name, so they have to agree with the map the player is standing on:
    // gym_1 is Rustler Pasture in the chip, in the quest line and in the
    // Brand it awards.
    for (const mapId of VENUE_ORDER) {
      const map = getMap(mapId);
      expect(map, `${mapId} is a venue but not a map`).toBeDefined();
      const terrain = terrainForVenue(mapId);
      expect(VENUE_TERRAIN[mapId], `${mapId} has no terrain`).toBe(terrain);
      // And the terrain the venue claims is a terrain the sim knows.
      expect(terrain.length).toBeGreaterThan(2);
    }
  });

  it("keeps old aliases out of the world", () => {
    // gym_1 used to be "the Roundup Grounds" in the keeper's greeting and on
    // the roadside sign while every other screen called it Rustler Pasture -
    // two names for one field, which reads as two places on the map.
    const aliases = ["Roundup Grounds"];
    const texts: string[] = [];
    for (const map of Object.values(MAPS)) {
      for (const npc of map.npcs) {
        if (npc.dialogue?.text) {
          texts.push(npc.dialogue.text);
        }
        for (const option of npc.dialogue?.options ?? []) {
          texts.push(option.label);
        }
      }
    }
    for (const alias of aliases) {
      expect(
        texts.some((text) => text.includes(alias)),
        `"${alias}" is a second name for a place that already has one`,
      ).toBe(false);
    }
  });
});

describe("the Inspector's shape readout", () => {
  const car = (wheels: number, drivenWheels: number, engines: number) => ({
    plates: 1,
    wheels,
    drivenWheels,
    engines,
  });

  it("says when the car fits the ground", () => {
    const line = shapeReadout(car(4, 4, 3), 3);
    expect(line).toContain("fits the ground");
    expect(line).toContain("at least three wheels, two of them driven");
    expect(line).toContain("4 driven");
  });

  it("says what is missing when it does not", () => {
    const line = shapeReadout(car(2, 1, 1), 4);
    expect(line).toContain("The ground wants at least four wheels, three of them driven");
    expect(line).toContain("this one has");
  });

  it("tells the truth about tier I, which asks nothing", () => {
    expect(shapeReadout(car(1, 0, 0), 1)).toContain("asks nothing of the build");
  });
});

describe("which Brand a ground awards", () => {
  it("names each arena's Brand, and falls back to the Grassland", () => {
    // The badge is the circuit's key: tiers, titles and the ledger all hang
    // off it, so a map with no entry would quietly become a Grassland feud.
    for (const mapId of VENUE_ORDER) {
      expect(badgeForMap(mapId)).toBe(VENUE_BADGE[mapId]);
    }
    expect(badgeForMap("starter_town")).toBe("Grassland Brand");
    expect(badgeForMap("nowhere_at_all")).toBe("Grassland Brand");
  });
});
