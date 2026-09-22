/**
 * Actors: one tile at a time, animated between tiles.
 *
 * Position is stored as the tile being stepped *onto*, plus the tile stepped
 * from and a 0..1 progress. That is what makes movement both authoritative
 * (collision asks about `x,y`, the destination) and smooth (the renderer asks
 * for a pixel between `stepFrom` and `x,y`) without either side guessing.
 */

import type { Cell } from "./grid.js";
import { tileKey } from "./grid.js";
import type { Facing } from "./direction.js";
import { facingVector } from "./direction.js";

export type ActorKind = "player" | "npc";

export interface ActorState {
  id: string;
  kind: ActorKind;
  mapId: string;
  /** The tile this actor occupies — the destination once a step is underway. */
  x: number;
  y: number;
  facing: Facing;
  /** Where the current step began; null when standing still. */
  stepFrom: Cell | null;
  /** 0..1 through the current step. */
  stepProgress: number;
  stepDurationMs: number;
  hidden: boolean;
}

export interface ActorInit {
  id: string;
  kind?: ActorKind;
  mapId: string;
  x: number;
  y: number;
  facing?: Facing;
  stepDurationMs?: number;
  hidden?: boolean;
}

export const DEFAULT_STEP_MS = 140;

export function createActorState(init: ActorInit): ActorState {
  return {
    id: init.id,
    kind: init.kind ?? "npc",
    mapId: init.mapId,
    x: init.x,
    y: init.y,
    facing: init.facing ?? "down",
    stepFrom: null,
    stepProgress: 0,
    stepDurationMs: init.stepDurationMs ?? DEFAULT_STEP_MS,
    hidden: init.hidden ?? false,
  };
}

export function isStepping(actor: ActorState): boolean {
  return actor.stepFrom !== null;
}

export function turnTo(actor: ActorState, facing: Facing): ActorState {
  if (actor.facing === facing) {
    return actor;
  }
  return { ...actor, facing };
}

/**
 * Begin a step onto the adjacent tile in `facing`. Callers must have checked
 * that the tile is free; this function is deliberately unconditional so the
 * collision rules stay in one place (the world's `canStepOnto`).
 */
export function beginStep(actor: ActorState, facing: Facing, durationMs?: number): ActorState {
  if (isStepping(actor)) {
    return actor;
  }
  const step = facingVector(facing);
  return {
    ...actor,
    facing,
    stepFrom: { x: actor.x, y: actor.y },
    stepProgress: 0,
    stepDurationMs: durationMs ?? actor.stepDurationMs,
    x: actor.x + step.x,
    y: actor.y + step.y,
  };
}

/** Advance an in-progress step. Returns the same object when nothing changed. */
export function advanceActor(actor: ActorState, deltaMs: number): ActorState {
  if (actor.stepFrom === null) {
    return actor;
  }
  const progress = actor.stepProgress + deltaMs / Math.max(1, actor.stepDurationMs);
  if (progress < 1) {
    return { ...actor, stepProgress: progress };
  }
  return { ...actor, stepFrom: null, stepProgress: 0 };
}

/** The tile an actor's feet are nearest to, for depth sorting and nudging. */
export function visualTile(actor: ActorState): { x: number; y: number } {
  if (actor.stepFrom === null) {
    return { x: actor.x, y: actor.y };
  }
  return {
    x: actor.stepFrom.x + (actor.x - actor.stepFrom.x) * actor.stepProgress,
    y: actor.stepFrom.y + (actor.y - actor.stepFrom.y) * actor.stepProgress,
  };
}

/** The top-left pixel of an actor, interpolated through the current step. */
export function actorPixel(actor: ActorState, tileSize: number): { x: number; y: number } {
  const tile = visualTile(actor);
  return { x: tile.x * tileSize, y: tile.y * tileSize };
}

/** The tile in front of an actor, which is what "interact" means. */
export function facingTile(actor: ActorState): Cell {
  const step = facingVector(actor.facing);
  return { x: actor.x + step.x, y: actor.y + step.y };
}

/** Every tile currently occupied, keyed by tile key. Stepping actors claim their destination. */
export function occupiedTiles(actors: readonly ActorState[]): Map<string, ActorState> {
  const occupied = new Map<string, ActorState>();
  for (const actor of actors) {
    if (actor.hidden) {
      continue;
    }
    occupied.set(tileKey(actor.x, actor.y), actor);
  }
  return occupied;
}

export function actorAt(
  actors: readonly ActorState[],
  x: number,
  y: number,
): ActorState | undefined {
  return actors.find((actor) => !actor.hidden && actor.x === x && actor.y === y);
}

/**
 * Slide every actor forward by `deltaMs` and report which ones finished a step
 * this frame — the moment a game checks warps and encounter tiles, because the
 * player has actually arrived.
 */
export function advanceActors(
  actors: readonly ActorState[],
  deltaMs: number,
): { actors: ActorState[]; arrived: ActorState[] } {
  const arrived: ActorState[] = [];
  const next = actors.map((actor) => {
    const before = isStepping(actor);
    const after = advanceActor(actor, deltaMs);
    if (before && !isStepping(after)) {
      arrived.push(after);
    }
    return after;
  });
  return { actors: next, arrived };
}
