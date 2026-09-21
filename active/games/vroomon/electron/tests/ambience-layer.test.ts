import { describe, expect, it } from "vitest";
import {
  ambientMotes,
  waterPhase,
  weatherFor,
  weatherForMap,
} from "../src/renderer/world/ambience-layer.js";

const VIEW = { minX: -100, minY: 50, width: 640, height: 360 };

describe("ambient life", () => {
  it("gives each biome its own weather", () => {
    expect(weatherFor("ranch_yard")).toBe("pollen");
    expect(weatherFor("marrow_orchard")).toBe("petal");
    expect(weatherFor("route_2")).toBe("dust");
    expect(weatherFor("rocky_map")).toBe("grit");
    expect(weatherFor("ice_map")).toBe("snow");
    expect(weatherFor("unknown_map")).toBe("pollen");
    // Inside a house, the weather is the dust in the air.
    expect(weatherForMap("ice_map", true)).toBe("dust");
    expect(weatherForMap("ice_map", false)).toBe("snow");
  });

  it("keeps motes inside the view and stable for a frame", () => {
    for (const tick of [0, 1, 250, 4800]) {
      const motes = ambientMotes("ranch_yard", tick, VIEW);
      expect(motes).toHaveLength(18);
      for (const mote of motes) {
        expect(mote.x).toBeGreaterThanOrEqual(VIEW.minX - 1);
        expect(mote.x).toBeLessThanOrEqual(VIEW.minX + VIEW.width + 1);
        expect(mote.y).toBeGreaterThanOrEqual(VIEW.minY - 1);
        expect(mote.y).toBeLessThanOrEqual(VIEW.minY + VIEW.height + 1);
        expect(mote.alpha).toBeGreaterThan(0);
        expect(mote.alpha).toBeLessThanOrEqual(1);
        expect(mote.size).toBeGreaterThan(0);
      }
      // Same tick, same frame: drawing must be reproducible.
      expect(ambientMotes("ranch_yard", tick, VIEW)).toEqual(motes);
    }
  });

  it("drifts over time without leaving the window", () => {
    const first = ambientMotes("ranch_yard", 0, VIEW);
    const later = ambientMotes("ranch_yard", 900, VIEW);
    expect(later).not.toEqual(first);
    const moved = later.filter((mote, index) => mote.x !== first[index]!.x);
    expect(moved.length).toBeGreaterThan(0);
  });

  it("counts and biome change what you see", () => {
    expect(ambientMotes("ranch_yard", 0, VIEW, 4)).toHaveLength(4);
    const snow = ambientMotes("ice_map", 0, VIEW, 3);
    expect(snow.every((mote) => mote.kind === "snow")).toBe(true);
    const petals = ambientMotes("marrow_orchard", 0, VIEW, 3);
    expect(petals.every((mote) => mote.kind === "petal")).toBe(true);
  });

  it("gives every water tile its own ripple phase", () => {
    const a = waterPhase(0, 3, 5);
    const b = waterPhase(0, 4, 5);
    expect(a).not.toBe(b);
    expect(waterPhase(100, 3, 5)).not.toBe(a);
    expect(Number.isFinite(a)).toBe(true);
  });
});
