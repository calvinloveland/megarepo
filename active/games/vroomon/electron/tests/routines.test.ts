import { describe, expect, it } from "vitest";
import {
  greetingFor,
  npcPositionAt,
  slotForPhase,
  standingFor,
} from "../src/renderer/world/routines.js";

describe("NPC routines", () => {
  it("stands still without a routine", () => {
    const npc = { x: 4, y: 5, facing: "down" as const };
    for (const phase of [0, 0.3, 0.9]) {
      expect(npcPositionAt(npc, phase)).toEqual({ x: 4, y: 5, facing: "down" });
    }
  });

  it("moves with the day", () => {
    const npc = {
      x: 1,
      y: 1,
      facing: "down" as const,
      routine: {
        morning: { x: 6, y: 3, facing: "left" as const },
        dusk: { x: 9, y: 9 },
      },
    };
    expect(npcPositionAt(npc, 0.25)).toEqual({ x: 6, y: 3, facing: "left" });
    expect(npcPositionAt(npc, 0.7)).toEqual({ x: 9, y: 9, facing: "down" });
  });

  it("borrows an earlier slot when one is missing", () => {
    // A watch that starts in the evening stays put through the night.
    const npc = {
      x: 2,
      y: 2,
      facing: "up" as const,
      routine: { dusk: { x: 8, y: 4 } },
    };
    expect(npcPositionAt(npc, 0.9)).toEqual({ x: 8, y: 4, facing: "up" });
    // Dawn has nothing before it, so it borrows forward and then stands still.
    expect(npcPositionAt(npc, 0.05)).toEqual({ x: 8, y: 4, facing: "up" });
    const noRoutine = { x: 2, y: 2, facing: "up" as const, routine: {} };
    expect(npcPositionAt(noRoutine, 0.05)).toEqual({ x: 2, y: 2, facing: "up" });
  });

  it("maps a day phase onto the same words the clock uses", () => {
    expect(slotForPhase(0)).toBe("dawn");
    expect(slotForPhase(0.2)).toBe("morning");
    expect(slotForPhase(0.5)).toBe("afternoon");
    expect(slotForPhase(0.7)).toBe("dusk");
    expect(slotForPhase(0.95)).toBe("night");
  });
});

describe("standing and greetings", () => {
  it("reads how well the world knows you", () => {
    const base = { badges: [], vroomdex: [], flags: {}, hallOfFameEntries: 0 };
    expect(standingFor(base)).toBe("new");
    expect(standingFor({ ...base, vroomdex: ["a", "b", "c"] })).toBe("known");
    expect(standingFor({ ...base, badges: ["Grassland Brand"] })).toBe("known");
    expect(standingFor({ ...base, badges: ["a", "b", "c"] })).toBe("champion");
    expect(standingFor({ ...base, hallOfFameEntries: 1 })).toBe("champion");
  });

  it("prefers what happened last race, then standing, then its own text", () => {
    const npc = {
      greetings: {
        new: "Who's this?",
        known: "Back again?",
        champion: "The champion of nowhere, is it?",
        "after:loss": "Told you my line was quick.",
        "after:win": "...I want another go.",
      },
    };
    expect(greetingFor(npc, "new", "loss")).toBe("Told you my line was quick.");
    expect(greetingFor(npc, "champion", "win")).toBe("...I want another go.");
    expect(greetingFor(npc, "champion", null)).toBe("The champion of nowhere, is it?");
    expect(greetingFor({ greetings: {} }, "champion", null)).toBeNull();
    expect(greetingFor({}, "new", null)).toBeNull();
  });
});
