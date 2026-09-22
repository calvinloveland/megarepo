// What people are doing: where they stand, and what they say about you.
//
// An NPC used to be a statue with a fixed tile and one paragraph. Now a
// villager can move with the day — the wrangler works the market in the
// morning and drinks at the gate by dusk — and can greet you differently
// depending on what you have actually done: nobody knows you yet, you have
// Brands, or you have a champion in the Hall.
//
// The day itself lives in the engine (`engine/schedule.ts`): the five phases,
// where one ends and the next begins, the walk back through the day for a
// missing slot, and the wrapping shift. It was written here first and then
// again there, which is the cost of an engine arriving late; this module is now
// the adapter that keeps Vroomon's own authored shape — a bare
// `Partial<Record<phase, stop>>` — reading the same way.
//
// Pure functions of (npc, clock, world), so the routines are testable without
// a canvas or a browser clock.

import {
  isWithinHours,
  phaseName,
  resolveRoutine,
  type DayPhase,
} from "../../engine/schedule.js";
import type { NpcDefinition } from "./types.js";

/** A place an NPC stands at a time of day. */
export interface RoutineStop {
  x: number;
  y: number;
  /** Optional leaning, for flavour. */
  facing?: "up" | "down" | "left" | "right";
}

/**
 * An NPC's day, keyed by the same words the ambience layer uses for the clock
 * (`dawn` / `morning` / `afternoon` / `dusk` / `night`). Missing slots fall
 * back to the stall before them, then to the one after, then to the NPC's own
 * tile.
 */
export type Routine = Partial<Record<DayPhase, RoutineStop>>;

/** Which part of the day a routine slot is for, from a 0..1 phase. */
export function slotForPhase(phase: number): DayPhase {
  return phaseName(phase);
}

/**
 * Where this NPC is standing right now. Without a routine they never move;
 * with one, a missing slot walks back through the day (a night watch stays
 * where the evening left them), then forward, then to their own tile.
 */
export function npcPositionAt(
  npc: Pick<NpcDefinition, "x" | "y" | "facing" | "routine" | "hours">,
  phase: number,
): { x: number; y: number; facing: "up" | "down" | "left" | "right" } | null {
  const stop = resolveRoutine(
    {
      stops: npc.routine ?? {},
      ...(npc.hours ? { hours: npc.hours } : {}),
    },
    phase,
    { x: npc.x, y: npc.y, facing: npc.facing },
  );
  if (!stop) {
    return null;
  }
  return { x: stop.x, y: stop.y, facing: stop.facing ?? npc.facing };
}

/**
 * Is this person about? `hours` is a phase range, and it wraps: a night watch
 * from 0.78 to 0.12 is out from dusk through dawn. People without hours are
 * always about.
 */
export function isOnShift(
  hours: { from: number; to: number } | undefined,
  phase: number,
): boolean {
  return isWithinHours(hours, phase);
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
