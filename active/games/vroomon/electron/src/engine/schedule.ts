/**
 * NPC schedules: where a person stands at each part of the day.
 *
 * A routine describes only what changes; a slot with no entry falls back to the
 * previous one, and the first slot is the fallback for the whole day. That way
 * "the shopkeeper is at the counter except on market morning" is two lines of
 * content instead of five copies of the same coordinate.
 */

import type { Facing } from "./direction.js";

/** The day, from dawn to night. Also the order used for fallbacks. */
export const DAY_PHASES = ["dawn", "morning", "afternoon", "dusk", "night"] as const;

export type DayPhase = (typeof DAY_PHASES)[number];

export interface RoutineStop {
  x: number;
  y: number;
  facing?: Facing;
}

/**
 * A slot may be a stop or a list of stops; a list is the alternation for a
 * patrol. An explicit `null` means "not here at all" — the night watch is off
 * duty at noon.
 */
export type RoutineSlot = RoutineStop | readonly RoutineStop[] | null;

export interface Routine {
  stops: Partial<Record<DayPhase, RoutineSlot>>;
  /**
   * When this person is about, as a phase range in day fractions
   * (0 = dawn, 0.5 = afternoon). It wraps, so a night watch is 0.78 → 0.12.
   * Absent means always.
   */
  hours?: { from: number; to: number };
}

/**
 * Resolve a routine at a fractional phase (0..1). Returns null when the person
 * is off duty, or when the routine offers nothing at or before this phase.
 */
export function resolveRoutine(routine: Routine, phase: number): RoutineStop | null {
  if (!isOnDuty(routine, phase)) {
    return null;
  }
  const index = phaseIndex(phase);
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const slot = routine.stops[DAY_PHASES[cursor]!];
    if (slot === undefined) {
      continue;
    }
    if (slot === null) {
      return null;
    }
    if (Array.isArray(slot)) {
      const stops = slot as readonly RoutineStop[];
      if (stops.length === 0) {
        return null;
      }
      // Alternate between patrol stops on a slow beat so a guard walks a line
      // rather than teleporting between two tiles every frame.
      return stops[Math.floor(phase * 8) % stops.length]!;
    }
    return slot as RoutineStop;
  }
  return null;
}

export function isOnDuty(routine: Routine, phase: number): boolean {
  const hours = routine.hours;
  if (!hours) {
    return true;
  }
  const { from, to } = hours;
  if (from <= to) {
    return phase >= from && phase <= to;
  }
  // A range that crosses midnight.
  return phase >= from || phase <= to;
}

/**
 * Which named phase a fraction of the day falls in. Five equal windows, which
 * is coarse on purpose: a routine is authored in words, not minutes.
 */
export function phaseIndex(phase: number): number {
  const clamped = Math.min(0.999, Math.max(0, phase));
  return Math.min(DAY_PHASES.length - 1, Math.floor(clamped * DAY_PHASES.length));
}

export function phaseName(phase: number): DayPhase {
  return DAY_PHASES[phaseIndex(phase)]!;
}
