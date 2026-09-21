// What the player knows about each hunting ground, assembled for a screen.
//
// Scoring a pack is real work (two dozen cars, raced alone), so this never
// scores anything itself: it reports what the game already measured when the
// player last met that ground's animals. Grounds never hunted read as unmet,
// which is the honest answer — you cannot know what lives somewhere you have
// not been.

import { MAPS } from "./world/maps.js";
import { wildTerrainFor } from "../core/wild.js";

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
