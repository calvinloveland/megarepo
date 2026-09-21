// What the player knows about each hunting ground, assembled for a screen.
//
// Scoring a pack is real work (two dozen cars, raced alone), so this never
// scores anything itself: it reports what the game already measured when the
// player last met that ground's animals. Grounds never hunted read as unmet,
// which is the honest answer — you cannot know what lives somewhere you have
// not been.

import { MAPS } from "./world/maps.js";
import { wildTerrainFor } from "../core/wild.js";
import { tierLabel } from "./circuit.js";

/** A pack as last measured, kept in memory by the renderer. */
export interface PackReading {
  generation: number;
  /** What an encounter sends: the pack's median animal. */
  median: number;
  /** The strongest animal alive on that ground. */
  champion: number;
}

export interface WildGroundRow {
  mapId: string;
  name: string;
  terrain: string;
  generation: number;
  median: number;
  champion: number;
}

/**
 * The grounds the player has actually met, richest first. `readings` holds a
 * pack's last measured numbers, and `generations` the count from the save; a
 * ground with a generation but no reading (a save from another session) still
 * lists, without numbers.
 */
export function wildGroundRows(
  generations: Record<string, number>,
  readings: Record<string, PackReading>,
): WildGroundRow[] {
  const rows: WildGroundRow[] = [];
  for (const mapId of new Set([...Object.keys(readings), ...Object.keys(generations)])) {
    const map = MAPS[mapId];
    if (!map) {
      continue;
    }
    const reading = readings[mapId];
    const generation = Math.max(generations[mapId] ?? 0, reading?.generation ?? 0);
    rows.push({
      mapId,
      name: map.name,
      terrain: wildTerrainFor(mapId),
      generation,
      median: Math.round(reading?.median ?? 0),
      champion: Math.round(reading?.champion ?? 0),
    });
  }
  return rows.sort((left, right) => right.median - left.median || left.name.localeCompare(right.name));
}

/** "Ice — Drift Perimeter · wild gen 12 · sends 640 · best 1622" */
export function describeWildGround(row: WildGroundRow): string {
  if (row.generation <= 0) {
    return `${row.name} · unmet`;
  }
  const numbers =
    row.median > 0
      ? ` · sends ${row.median} · best ${row.champion}`
      : "";
  return `${row.terrain} — ${row.name} · wild gen ${row.generation}${numbers}`;
}


/**
 * The best animal any met ground on a terrain would send, per terrain. The
 * records board compares the player's own best lap there against it, so "where
 * you hunt matters" arrives next to the number it matters for.
 */
export function wildSendByTerrain(rows: WildGroundRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.median <= 0) {
      continue;
    }
    out[row.terrain] = Math.max(out[row.terrain] ?? 0, row.median);
  }
  return out;
}

/** "· wild sends 884" — or nothing when no met ground carries that terrain. */
export function wildSendNote(terrain: string, sends: Record<string, number>): string {
  const value = sends[terrain];
  return value && value > 0 ? ` · wild sends ${Math.round(value)}` : "";
}


export interface TierWalkHint {
  terrain: string;
  tier: number;
  bar: number;
  /** The met ground on that terrain that sends the most, if any. */
  best: WildGroundRow | null;
  /** One line the records board can print under the wild table. */
  text: string;
}

/**
 * Which ground is worth a walk for the tier you are actually facing. The table
 * says what each pack sends; this says whether any of them answers the bar in
 * front of you, which is the question a player is really asking when they open
 * the barn.
 */
export function tierWalkHint(
  rows: WildGroundRow[],
  target: { terrain: string; tier: number; bar: number },
): TierWalkHint {
  const onTerrain = rows
    .filter((row) => row.terrain === target.terrain && row.median > 0)
    .sort((left, right) => right.median - left.median);
  const best = onTerrain[0] ?? null;
  const where = `${target.terrain} ${tierLabel(target.tier)}`;

  if (!best) {
    return {
      ...target,
      best: null,
      text: `No pack met on ${target.terrain} yet — walk the grass there to see what it sends.`,
    };
  }
  if (best.median >= target.bar) {
    return {
      ...target,
      best,
      text: `${best.name} sends ${Math.round(best.median)} — that clears ${where} (${Math.round(target.bar)}). Worth the walk.`,
    };
  }
  return {
    ...target,
    best,
    text: `Nothing met sends ${Math.round(target.bar)} for ${where} yet; the best is ${best.name} at ${Math.round(best.median)}.`,
  };
}
