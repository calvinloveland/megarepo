import { describe, expect, it } from "vitest";
import {
  DAY_LENGTH_MS,
  ambientMotes,
  dayPhase,
  dayTint,
  footstepPuffs,
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

describe("time of day and footsteps", () => {
  it("cycles through a day and wraps", () => {
    expect(dayPhase(0)).toBe(0);
    expect(dayPhase(DAY_LENGTH_MS / 2)).toBeCloseTo(0.5, 5);
    expect(dayPhase(DAY_LENGTH_MS)).toBeCloseTo(0, 5);
    expect(dayPhase(DAY_LENGTH_MS * 3 + 10)).toBeCloseTo(dayPhase(10), 5);
  });

  it("names the hour and keeps the tint light", () => {
    const labels = [0, 0.2, 0.5, 0.7, 0.9].map((fraction) =>
      dayTint(Math.round(fraction * DAY_LENGTH_MS)).label,
    );
    expect(labels).toEqual(["dawn", "morning", "afternoon", "dusk", "night"]);
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.95]) {
      const tint = dayTint(Math.round(fraction * DAY_LENGTH_MS));
      // Never heavy enough to hurt legibility.
      expect(tint.alpha).toBeGreaterThan(0);
      expect(tint.alpha).toBeLessThanOrEqual(0.2);
      expect(tint.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("draws fading puffs only for recent steps", () => {
    const tracks = [
      { x: 3, y: 4, at: 1000 },
      { x: 4, y: 4, at: 1180 },
      { x: 5, y: 4, at: 400 },
    ];
    const puffs = footstepPuffs(tracks, 1200, { lifeMs: 260, tileSize: 32 });
    // The step from 800ms ago has faded out entirely.
    expect(puffs).toHaveLength(2);
    // The later step is fresher, so it is bolder.
    expect(puffs[1]!.alpha).toBeGreaterThan(puffs[0]!.alpha);
    expect(puffs[0]!.x).toBe(3 * 32 + 16);
    expect(puffs[0]!.y).toBe(4 * 32 + 28);
    expect(footstepPuffs(tracks, 2400)).toHaveLength(0);
  });
});

describe("the clock behaves like a clock", () => {
  it("runs a day in minutes, not seconds", () => {
    // The renderer's clock is performance.now() in milliseconds. Treating
    // milliseconds as if they were frames made the day cycle every few
    // seconds, which is the mistake this asserts against.
    expect(DAY_LENGTH_MS).toBeGreaterThanOrEqual(120_000);
    // Dawn through dusk stays in one phase for a while.
    const labels = new Set(
      Array.from({ length: 10 }, (_, index) => dayTint(index * 5_000).label),
    );
    expect(labels.size).toBeLessThanOrEqual(2);
  });

  it("drifts motes at walking pace", () => {
    const start = ambientMotes("ranch_yard", 0, VIEW, 6);
    const afterSecond = ambientMotes("ranch_yard", 1000, VIEW, 6);
    for (let index = 0; index < start.length; index += 1) {
      const dx = Math.abs(afterSecond[index]!.x - start[index]!.x);
      const dy = Math.abs(afterSecond[index]!.y - start[index]!.y);
      // A mote should move a few pixels a second, allowing for the wrap.
      expect(Math.min(dx, VIEW.width - dx)).toBeLessThan(30);
      expect(Math.min(dy, VIEW.height - dy)).toBeLessThan(20);
    }
  });
});
