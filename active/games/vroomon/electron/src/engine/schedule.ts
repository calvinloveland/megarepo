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

/**
 * Where the day changes its name, as fractions of it. The defaults are the day
 * Vroomon walks by — a short dawn, a long morning — and they are configuration
 * rather than a constant because a five-minute day and a twenty-minute one do
 * not have the same afternoon. One entry per phase, ascending, starting at 0.
 */
export const DEFAULT_PHASE_BOUNDARIES: readonly number[] = [0, 0.12, 0.38, 0.6, 0.78];

function assertBoundaries(boundaries: readonly number[]): void {
  if (boundaries.length !== DAY_PHASES.length) {
    throw new Error(`a day has ${DAY_PHASES.length} phases; got ${boundaries.length} boundaries`);
  }
  if (boundaries[0] !== 0) {
    throw new Error("the day starts at 0");
  }
  for (let index = 1; index < boundaries.length; index += 1) {
    if (!(boundaries[index]! > boundaries[index - 1]!)) {
      throw new Error(`phase boundaries must ascend, got ${boundaries.join(", ")}`);
    }
  }
}

assertBoundaries(DEFAULT_PHASE_BOUNDARIES);

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
 * Resolve a routine at a fractional phase (0..1).
 *
 * A missing slot walks *back* through the day first — a night watch stays where
 * the evening left them — then *forward* (a dawn with nothing before it borrows
 * from later), then falls back to the caller's stop, usually the person's own
 * tile. An explicit `null` means off duty from here on, and stops the walk.
 * Returns null when the person is not about at all.
 */
export function resolveRoutine(
  routine: Routine,
  phase: number,
  fallback: RoutineStop | null = null,
): RoutineStop | null {
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
    return pickStop(slot, phase);
  }

  for (let cursor = index + 1; cursor < DAY_PHASES.length; cursor += 1) {
    const slot = routine.stops[DAY_PHASES[cursor]!];
    if (slot === undefined || slot === null) {
      continue;
    }
    return pickStop(slot, phase);
  }

  return fallback;
}

function pickStop(slot: Exclude<RoutineSlot, null>, phase: number): RoutineStop | null {
  if (!Array.isArray(slot)) {
    return slot as RoutineStop;
  }
  const stops = slot as readonly RoutineStop[];
  if (stops.length === 0) {
    return null;
  }
  // Alternate between patrol stops on a slow beat so a guard walks a line
  // rather than teleporting between two tiles every frame.
  return stops[Math.floor(phase * 8) % stops.length]!;
}

export function isOnDuty(routine: Routine, phase: number): boolean {
  return isWithinHours(routine.hours, phase);
}

/**
 * Is this person about? `hours` is a phase range, and it wraps: a night watch
 * from 0.78 to 0.12 is out from dusk through dawn. No hours means always.
 */
export function isWithinHours(
  hours: { from: number; to: number } | undefined,
  phase: number,
): boolean {
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
 * Which named phase a fraction of the day falls in: the last boundary at or
 * before it. Coarse on purpose — a routine is authored in words, not minutes.
 */
export function phaseIndex(
  phase: number,
  boundaries: readonly number[] = DEFAULT_PHASE_BOUNDARIES,
): number {
  const clamped = Math.min(0.999999, Math.max(0, phase));
  let index = 0;
  for (let cursor = 0; cursor < boundaries.length; cursor += 1) {
    if (clamped >= boundaries[cursor]!) {
      index = cursor;
    }
  }
  return Math.min(DAY_PHASES.length - 1, index);
}

export function phaseName(
  phase: number,
  boundaries: readonly number[] = DEFAULT_PHASE_BOUNDARIES,
): DayPhase {
  return DAY_PHASES[phaseIndex(phase, boundaries)]!;
}
