// Provenance for the Herd Book: where each specimen came from and what it did.
//
// The Vroomdex used to be a bare list of DNA strings — a specimen off the ice
// read exactly like one off the home paddock, and nothing remembered what it
// ran. Now every catch and every purchase records the ground it came off, the
// distance it managed, and when, so the collection can be read: which biomes
// you have hunted, which line came from where, and what your best wild catch
// actually was.
//
// Pure and testable: the renderer only supplies the map id and a timestamp.

export interface SpecimenMeta {
  /** The biome whose pack bred it. */
  mapId: string;
  /** What it ran when you met it, in pixels. */
  score: number;
  /** ISO timestamp of the catch or purchase. */
  caughtAt: string;
  /** "caught" off the grass, or "bought" at Oxide's counter. */
  origin: "caught" | "bought";
}

export interface SpecimenEntry {
  dna: string;
  meta: SpecimenMeta | null;
}

export interface DexSummary {
  total: number;
  /** How many distinct biomes the herd book has drawn from. */
  biomes: number;
  /** The best wild animal you have brought in. */
  best: { dna: string; score: number } | null;
  /** How many are still only on paper (a genome, no note of where from). */
  unrecorded: number;
}

/**
 * Add a note for a specimen, dropping notes for genomes the Herd Book has
 * aged out (it keeps the most recent 200, so the two stay the same size).
 */
export function recordSpecimen(
  meta: Record<string, SpecimenMeta>,
  dna: string,
  entry: SpecimenMeta,
  vroomdex: string[],
): Record<string, SpecimenMeta> {
  const next = { ...meta, [dna]: entry };
  if (vroomdex.includes(dna)) {
    return next;
  }
  // The caller may add the DNA to the dex in the same tick; keep entries for
  // anything the dex still holds plus this one.
  return pruneSpecimenMeta(next, [...vroomdex, dna]);
}

/** Keep only the notes whose genomes the Herd Book still carries. */
export function pruneSpecimenMeta(
  meta: Record<string, SpecimenMeta>,
  vroomdex: string[],
): Record<string, SpecimenMeta> {
  const kept: Record<string, SpecimenMeta> = {};
  for (const dna of vroomdex) {
    const entry = meta[dna];
    if (entry) {
      kept[dna] = entry;
    }
  }
  return kept;
}

/** The Herd Book with its notes, newest first. */
export function specimenEntries(
  vroomdex: string[],
  meta: Record<string, SpecimenMeta>,
): SpecimenEntry[] {
  return [...vroomdex]
    .reverse()
    .map((dna) => ({ dna, meta: meta[dna] ?? null }));
}

export function dexSummary(entries: SpecimenEntry[]): DexSummary {
  const biomes = new Set<string>();
  let best: { dna: string; score: number } | null = null;
  let unrecorded = 0;

  for (const entry of entries) {
    if (!entry.meta) {
      unrecorded += 1;
      continue;
    }
    biomes.add(entry.meta.mapId);
    if (!best || entry.meta.score > best.score) {
      best = { dna: entry.dna, score: Math.round(entry.meta.score) };
    }
  }

  return { total: entries.length, biomes: biomes.size, best, unrecorded };
}

/** How long ago a note was made, in words: "just now", "3 days ago". */
export function ageLabel(
  caughtAt: string,
  now: string = new Date().toISOString(),
): string {
  const then = Date.parse(caughtAt);
  const current = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(current)) {
    return "unrecorded";
  }
  const minutes = Math.max(0, Math.round((current - then) / 60000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
