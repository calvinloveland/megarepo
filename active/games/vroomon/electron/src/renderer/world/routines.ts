// What people are doing: where they stand, and what they say about you.
//
// An NPC used to be a statue with a fixed tile and one paragraph. Now a
// villager can move with the day — the wrangler works the market in the
// morning and drinks at the gate by dusk — and can greet you differently
// depending on what you have actually done: nobody knows you yet, you have
// Brands, or you have a champion in the Hall.
//
// Pure functions of (npc, clock, world), so the routines are testable without
// a canvas or a browser clock.

import type { NpcDefinition } from "./types.js";

/** A place an NPC stands at a time of day. */
export interface RoutineStop {
  x: number;
  y: number;
  /** Optional leaning, for flavour. */
  facing?: "up" | "down" | "left" | "right";
}

/**
 * An NPC's day, keyed by the same words the ambience layer uses for the
 * clock (`dawn` / `morning` / `afternoon` / `dusk` / `night`). Missing slots
 * fall back to the stall before them, then to the NPC's own tile.
 */
export type Routine = Partial<Record<"dawn" | "morning" | "afternoon" | "dusk" | "night", RoutineStop>>;

const ORDER: Array<keyof Routine> = ["dawn", "morning", "afternoon", "dusk", "night"];

/** Which part of the day a routine slot is for, from a 0..1 phase. */
export function slotForPhase(phase: number): keyof Routine {
  if (phase < 0.12) return "dawn";
  if (phase < 0.38) return "morning";
  if (phase < 0.6) return "afternoon";
  if (phase < 0.78) return "dusk";
  return "night";
}

/**
 * Where this NPC is standing right now. Without a routine they never move;
 * with one, a missing slot walks *back* through the day (a night watch stays
 * where the evening left them) and finally to their own tile.
 */
export function npcPositionAt(
  npc: Pick<NpcDefinition, "x" | "y" | "facing" | "routine" | "hours">,
  phase: number,
): { x: number; y: number; facing: "up" | "down" | "left" | "right" } | null {
  if (!isOnShift(npc.hours, phase)) {
    return null;
  }
  const routine = npc.routine;
  if (!routine) {
    return { x: npc.x, y: npc.y, facing: npc.facing };
  }

  const slot = slotForPhase(phase);
  const index = ORDER.indexOf(slot);
  for (let step = index; step >= 0; step -= 1) {
    const stop = routine[ORDER[step]!];
    if (stop) {
      return { x: stop.x, y: stop.y, facing: stop.facing ?? npc.facing };
    }
  }
  // Nothing earlier in the day: borrow from later, then give up and stand still.
  for (let step = index; step < ORDER.length; step += 1) {
    const stop = routine[ORDER[step]!];
    if (stop) {
      return { x: stop.x, y: stop.y, facing: stop.facing ?? npc.facing };
    }
  }
  return { x: npc.x, y: npc.y, facing: npc.facing };
}

/**
 * Is this person about? `hours` is a phase range, and it wraps: a night
 * watch from 0.78 to 0.12 is out from dusk through dawn. People without
 * hours are always about.
 */
export function isOnShift(
  hours: { from: number; to: number } | undefined,
  phase: number,
): boolean {
  if (!hours) {
    return true;
  }
  if (hours.from <= hours.to) {
    return phase >= hours.from && phase <= hours.to;
  }
  return phase >= hours.from || phase <= hours.to;
}

/** How well the world knows this rancher. */
export type Standing = "new" | "known" | "champion";

export interface StandingInput {
  badges: string[];
  vroomdex: string[];
  flags: Record<string, boolean>;
  hallOfFameEntries: number;
}

export function standingFor(world: StandingInput): Standing {
  if (world.hallOfFameEntries > 0 || world.badges.length >= 3) {
    return "champion";
  }
  if (world.badges.length > 0 || world.vroomdex.length >= 3) {
    return "known";
  }
  return "new";
}

/**
 * The line an NPC opens with. A `greetings` map on the NPC overrides its
 * written text for the rancher's standing, and a `rivalGreetings` map lets a
 * racing rival remember the last time you lined up.
 */
export function greetingFor(
  npc: Pick<NpcDefinition, "greetings">,
  standing: Standing,
  lastRace: "win" | "loss" | null,
): string | null {
  if (lastRace && npc.greetings?.[`after:${lastRace}`]) {
    return npc.greetings[`after:${lastRace}`] ?? null;
  }
  return npc.greetings?.[standing] ?? null;
}
