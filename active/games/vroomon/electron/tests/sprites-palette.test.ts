import { describe, expect, it } from "vitest";
import {
  HOUSE_ACCENTS,
  HOST_ACCENTS,
  houseAccentForNpc,
  SPRITE_PALETTE,
} from "../src/renderer/world/sprites-palette.js";
import { MAPS } from "../src/renderer/world/maps.js";

describe("sprite palette", () => {
  it("defines roles referenced by the renderer", () => {
    expect(SPRITE_PALETTE.skin.light).toBe("#f7d4a0");
    expect(SPRITE_PALETTE.skin.mid).toBe("#f0c896");
    expect(SPRITE_PALETTE.accent.gold).toBe("#ffd166");
    expect(SPRITE_PALETTE.accent.blue).toBe("#7dd3fc");
    expect(SPRITE_PALETTE.cap.navy).toBe("#1f3a5a");
    expect(SPRITE_PALETTE.body.navy).toBe("#2a4a7a");
    expect(SPRITE_PALETTE.ink.eyes).toBe("#0a0a0a");
    expect(SPRITE_PALETTE.shadow).toBe("rgba(0,0,0,0.18)");
  });

  it("gives each faction house a signature accent", () => {
    const ids = Object.keys(HOUSE_ACCENTS);
    expect(ids).toHaveLength(10);
    const values = Object.values(HOUSE_ACCENTS);
    expect(new Set(values).size).toBe(10); // all distinct
  });

  it("maps every overworld host to its house accent", () => {
    // Every host npc id in the mapping exists in the maps and renders it.
    for (const [npcId] of Object.entries(HOST_ACCENTS)) {
      const present = Object.values(MAPS).some((map) =>
        map.npcs.some((npc) => npc.id === npcId),
      );
      expect(present, `host ${npcId} should exist in a map`).toBe(true);
      expect(houseAccentForNpc(npcId), npcId).toBeTruthy();
    }
    expect(houseAccentForNpc("some-rival")).toBeNull();
  });
});
