import { describe, it, expect } from "vitest";
import { applyTagBehaviors } from "../../sim/tag_behaviors";

describe("tag behaviors", () => {
  it("reactive water triggers explosion", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const tagsById = new Map<number, string[]>();
    const nameToId = new Map<string, number>();
    const reacted = new Uint8Array(width * height);

    const sodiumId = 1;
    const waterId = 2;
    const steamId = 3;
    const smokeId = 4;

    tagsById.set(sodiumId, ["sand", "reactive_water", "explosive"]);
    tagsById.set(waterId, ["flow", "water"]);
    nameToId.set("Steam", steamId);
    nameToId.set("Smoke", smokeId);

    const idx = 1 + 1 * width;
    const nidx = 2 + 1 * width;
    grid[idx] = sodiumId;
    grid[nidx] = waterId;

    const result = applyTagBehaviors(sodiumId, 1, 1, idx, tagsById.get(sodiumId)!, {
      width,
      height,
      grid,
      nextGrid,
      tagsById,
      nameToId,
      reacted,
      rng: () => 0.0,
    });

    expect(result.consumed).toBe(true);
    expect(nextGrid[idx]).toBe(steamId);
    expect(nextGrid[nidx]).toBe(steamId);
  });

  it("fire burns out into smoke", () => {
    const width = 2;
    const height = 2;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const tagsById = new Map<number, string[]>();
    const nameToId = new Map<string, number>();
    const reacted = new Uint8Array(width * height);

    const fireId = 5;
    const smokeId = 6;
    tagsById.set(fireId, ["float", "fire", "burns_out"]);
    nameToId.set("Smoke", smokeId);

    const idx = 0;
    grid[idx] = fireId;

    const result = applyTagBehaviors(fireId, 0, 0, idx, tagsById.get(fireId)!, {
      width,
      height,
      grid,
      nextGrid,
      tagsById,
      nameToId,
      reacted,
      rng: () => 0.0,
    });

    expect(result.consumed).toBe(true);
    expect(nextGrid[idx]).toBe(smokeId);
  });

  it("fire ignites flammable neighbors", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const tagsById = new Map<number, string[]>();
    const nameToId = new Map<string, number>();
    const reacted = new Uint8Array(width * height);

    const fireId = 7;
    const oilId = 8;
    tagsById.set(fireId, ["float", "fire"]);
    tagsById.set(oilId, ["flow", "flammable"]);

    const idx = 1 + 1 * width;
    const nidx = 2 + 1 * width;
    grid[idx] = fireId;
    grid[nidx] = oilId;

    const result = applyTagBehaviors(fireId, 1, 1, idx, tagsById.get(fireId)!, {
      width,
      height,
      grid,
      nextGrid,
      tagsById,
      nameToId,
      reacted,
      rng: () => 0.0,
    });

    expect(result.consumed).toBe(false);
    expect(nextGrid[nidx]).toBe(fireId);
  });
});
