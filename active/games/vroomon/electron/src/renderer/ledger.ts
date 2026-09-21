// The ledger: what each ground has produced, against what it now asks for.
//
// The Record Barn holds per-terrain bests and the circuit holds a rising bar
// per biome, but nothing put the two side by side — so a rancher could not
// tell whether their champion still clears the ground they are about to race,
// or how much more they need. This is that comparison, as a pure table:
//
//   terrain | your best (and the car that set it) | the bar you face | by how much
//
// "Defend the title" is the interesting row: after a sweep the bar moves up,
// and a best that no longer clears it is exactly what the circuit is for.

import type { RecordEntry } from "../shared/parity-contract.js";
import { feudBar, terrainForVenue, VENUE_BADGE, VENUE_ORDER } from "./circuit.js";

export interface LedgerRow {
  terrain: string;
  venueMapId: string;
  /** Your best on this ground, if you have one. */
  best: number;
  dna: string | null;
  /** The tier you would face here now. */
  tier: number;
  /** The score that tier asks for. */
  bar: number;
  /** best - bar: negative means you would be turned away. */
  margin: number;
  /** "clears", "short", or "untried" when there is no best at all. */
  status: "clears" | "short" | "untried";
}

export interface LedgerInput {
  records: RecordEntry[];
  /** arena mapId -> tier, as the world stores it. */
  feudTiers: Record<string, number>;
  /** The sky's effect on every bar (1 = clear). */
  defence?: number;
  /** The Record Barn: champions you could actually put on the line. */
  hallScores: Array<{ terrainName: string; score: number; dna?: string }>;
}

/**
 * One row per circuit, in campaign order. `records` is the lap board (what
 * the herd has run); the Hall's champions count too, since a champion you
 * enshrined is a car you can still send.
 */
export function buildLedger(input: LedgerInput): LedgerRow[] {
  return VENUE_ORDER.map((venueMapId) => {
    const terrain = terrainForVenue(venueMapId);
    const badge = VENUE_BADGE[venueMapId] ?? "";
    const tier = input.feudTiers[badge] ?? 1;
    const bar = feudBar(terrain, tier, input.defence ?? 1);

    const fromRecords = input.records
      .filter((entry) => entry.terrainName === terrain)
      .reduce<RecordEntry | null>(
        (best, entry) => (best === null || entry.score > best.score ? entry : best),
        null,
      );
    const hallBest = input.hallScores
      .filter((entry) => entry.terrainName === terrain)
      .reduce<{ score: number; dna?: string } | null>(
        (best, entry) => (best === null || entry.score > best.score ? entry : best),
        null,
      );
    const hallScore = hallBest?.score ?? 0;
    const best = Math.max(fromRecords?.score ?? 0, hallScore);
    // Name the car that set the best, whether it came off a lap or out of the
    // Hall — an anonymous number is less use than a name you can look up. A
    // Hall entry only carries a DNA when one was saved with it, so fall back.
    const lapDna = fromRecords?.dna ?? null;
    const dna =
      fromRecords && fromRecords.score >= hallScore
        ? lapDna
        : (hallBest?.dna ?? lapDna);

    if (best <= 0) {
      return { terrain, venueMapId, best: 0, dna: null, tier, bar, margin: -bar, status: "untried" };
    }
    const margin = best - bar;
    return {
      terrain,
      venueMapId,
      best,
      dna,
      tier,
      bar,
      margin,
      status: margin >= 0 ? "clears" : "short",
    };
  });
}

/** The rows worth nagging about: a bar your best no longer clears. */
export function titlesToDefend(rows: LedgerRow[]): LedgerRow[] {
  return rows.filter((row) => row.status === "short");
}

/** The rows you have never run at all. */
export function untriedGrounds(rows: LedgerRow[]): LedgerRow[] {
  return rows.filter((row) => row.status === "untried");
}
