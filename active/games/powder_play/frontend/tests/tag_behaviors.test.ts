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

  it("seed grows into plant when touching mud", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const tagsById = new Map<number, string[]>();
    const nameToId = new Map<string, number>();
    const reacted = new Uint8Array(width * height);

    const seedId = 9;
    const mudId = 10;
    const plantId = 11;
    const dirtId = 12;
    tagsById.set(seedId, ["sand", "seed"]);
    tagsById.set(mudId, ["flow", "mud"]);
    nameToId.set("Plant", plantId);
    nameToId.set("Dirt", dirtId);

    const idx = 1 + 1 * width;
    const nidx = 1 + 2 * width;
    grid[idx] = seedId;
    grid[nidx] = mudId;

    const result = applyTagBehaviors(seedId, 1, 1, idx, tagsById.get(seedId)!, {
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
    expect(nextGrid[idx]).toBe(plantId);
    expect(nextGrid[nidx]).toBe(dirtId);
  });

  it("plant grows upward when space is empty", () => {
    const width = 3;
    const height = 3;
    const grid = new Uint16Array(width * height);
    const nextGrid = new Uint16Array(width * height);
    const tagsById = new Map<number, string[]>();
    const nameToId = new Map<string, number>();
    const reacted = new Uint8Array(width * height);

    const plantId = 13;
    tagsById.set(plantId, ["static", "plant", "grow"]);
    nameToId.set("Plant", plantId);

    const idx = 1 + 1 * width;
    grid[idx] = plantId;

    const result = applyTagBehaviors(plantId, 1, 1, idx, tagsById.get(plantId)!, {
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
    expect(nextGrid[1 + 0 * width]).toBe(plantId);
  });
});
