/**
 * The collector's half of the game: specimens, breeding and a herd book.
 *
 * A genome is an opaque string here. What it *means* — a car, a creature, a
 * plant — is the game's business; the engine owns inheritance (crossover,
 * mutation), provenance (parents, generation, where it came from) and the
 * storage rules (capacity, no duplicates).
 */

import { createRng, type Rng } from "./rng.js";

export interface GenomeCodec {
  /** One child genome from two parents. */
  crossover(mother: string, father: string, rng: Rng): string;
  /** A mutated copy; `rate` is a per-gene chance. */
  mutate(genome: string, rng: Rng, rate: number): string;
  /** Is this a genome at all? */
  validate(genome: string): boolean;
  /** A random genome of roughly `length` genes. */
  random(rng: Rng, length: number): string;
}

/** Hex DNA, the classic: a genome is a string over a fixed alphabet. */
export function createCharacterCodec(alphabet = "0123456789abcdef"): GenomeCodec {
  if (alphabet.length < 2) {
    throw new Error("createCharacterCodec needs at least two characters");
  }
  return {
    crossover: (mother, father, rng) => {
      const length = Math.min(mother.length, father.length);
      let child = "";
      for (let index = 0; index < length; index += 1) {
        child += rng.bool() ? mother[index]! : father[index]!;
      }
      return child;
    },
    mutate: (genome, rng, rate) => {
      let out = "";
      for (const gene of genome) {
        if (rng.bool(rate)) {
          out += alphabet[rng.int(alphabet.length)]!;
        } else {
          out += gene;
        }
      }
      return out;
    },
    validate: (genome) =>
      genome.length > 0 && [...genome].every((gene) => alphabet.includes(gene)),
    random: (rng, length) => {
      let out = "";
      for (let index = 0; index < length; index += 1) {
        out += alphabet[rng.int(alphabet.length)]!;
      }
      return out;
    },
  };
}

export interface Specimen {
  id: string;
  genome: string;
  species?: string;
  /** How many generations from the founders this specimen is. */
  generation: number;
  /** The parents' ids, when this one was bred. */
  parents: [string, string] | null;
  caughtAt: string;
  origin: "caught" | "bred" | "bought";
  tags?: string[];
}

export interface SpecimenInit {
  id: string;
  genome: string;
  species?: string;
  generation?: number;
  parents?: [string, string] | null;
  caughtAt?: string;
  origin?: Specimen["origin"];
  tags?: string[];
}

export function createSpecimen(init: SpecimenInit): Specimen {
  return {
    id: init.id,
    genome: init.genome,
    ...(init.species === undefined ? {} : { species: init.species }),
    generation: init.generation ?? 0,
    parents: init.parents ?? null,
    caughtAt: init.caughtAt ?? new Date().toISOString(),
    origin: init.origin ?? "caught",
    ...(init.tags === undefined ? {} : { tags: [...init.tags] }),
  };
}

export function nextSpecimenId(prefix: string, rng: Rng): string {
  const suffix = Math.floor(rng.next() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `${prefix}-${suffix}`;
}

export interface BreedOptions {
  codec: GenomeCodec;
  rng: Rng;
  /** Per-gene mutation chance. Defaults to 0.05. */
  mutationRate?: number;
  idPrefix?: string;
  species?: string;
  now?: () => Date;
}

export function breedSpecimens(mother: Specimen, father: Specimen, options: BreedOptions): Specimen {
  const rng = options.rng;
  const crossed = options.codec.crossover(mother.genome, father.genome, rng);
  const genome = options.codec.mutate(crossed, rng, options.mutationRate ?? 0.05);
  return createSpecimen({
    id: nextSpecimenId(options.idPrefix ?? "spec", rng),
    genome,
    ...(options.species === undefined ? {} : { species: options.species }),
    generation: Math.max(mother.generation, father.generation) + 1,
    parents: [mother.id, father.id],
    caughtAt: (options.now?.() ?? new Date()).toISOString(),
    origin: "bred",
  });
}

export type AddResult = { ok: true; specimen: Specimen } | { ok: false; reason: "full" | "duplicate" };

/** A herd book: bounded, deduplicated, and always able to name its best. */
export class Collection {
  private readonly byId = new Map<string, Specimen>();

  constructor(readonly capacity: number = 50) {
    if (capacity < 1) {
      throw new Error("a collection needs room for at least one specimen");
    }
  }

  get size(): number {
    return this.byId.size;
  }

  get isFull(): boolean {
    return this.byId.size >= this.capacity;
  }

  add(specimen: Specimen): AddResult {
    if (this.byId.has(specimen.id)) {
      return { ok: false, reason: "duplicate" };
    }
    if (this.isFull) {
      return { ok: false, reason: "full" };
    }
    this.byId.set(specimen.id, specimen);
    return { ok: true, specimen };
  }

  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  get(id: string): Specimen | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  list(): Specimen[] {
    return [...this.byId.values()];
  }

  /** Newest first, which is the order a herd book is usually read in. */
  recent(): Specimen[] {
    return [...this.byId.values()].sort((left, right) => right.caughtAt.localeCompare(left.caughtAt));
  }

  /** The specimen with the highest score, or null when there are none. */
  best(score: (specimen: Specimen) => number): Specimen | null {
    let best: Specimen | null = null;
    let bestScore = -Infinity;
    for (const specimen of this.byId.values()) {
      const value = score(specimen);
      if (value > bestScore) {
        bestScore = value;
        best = specimen;
      }
    }
    return best;
  }

  /** Descendants of a specimen, oldest first — the pedigree view's query. */
  descendantsOf(id: string): Specimen[] {
    const out: Specimen[] = [];
    const queue = [id];
    while (queue.length > 0) {
      const parent = queue.shift()!;
      for (const specimen of this.byId.values()) {
        if (specimen.parents?.includes(parent)) {
          out.push(specimen);
          queue.push(specimen.id);
        }
      }
    }
    return out.sort((left, right) => left.generation - right.generation);
  }

  snapshot(): Specimen[] {
    return this.list();
  }

  restore(specimens: readonly Specimen[]): void {
    this.byId.clear();
    for (const specimen of specimens) {
      if (this.byId.size >= this.capacity) {
        break;
      }
      this.byId.set(specimen.id, specimen);
    }
  }
}

export interface EvolutionOptions {
  codec: GenomeCodec;
  rng: Rng;
  /** Per-gene mutation chance. Defaults to 0.05. */
  mutationRate?: number;
  /** How many of the best survive untouched. Defaults to 1. */
  eliteCount?: number;
  /** How many parents to draw from per child. Defaults to 4. */
  tournamentSize?: number;
}

export interface EvolutionResult {
  genomes: string[];
  scores: number[];
  best: { genome: string; score: number };
  average: number;
  generation: number;
}

/**
 * One generation of selection: score everyone, keep the elite, breed the rest
 * from tournament winners. The scoring function is the game's — the engine only
 * owns the loop, which is the part that is easy to get subtly wrong.
 */
export function evolveOnce(
  genomes: readonly string[],
  score: (genome: string) => number,
  options: EvolutionOptions,
): EvolutionResult {
  if (genomes.length === 0) {
    throw new Error("evolveOnce needs a population");
  }
  const rng = options.rng;
  const eliteCount = Math.max(1, Math.min(genomes.length, options.eliteCount ?? 1));
  const tournamentSize = Math.max(1, options.tournamentSize ?? 4);
  const mutationRate = options.mutationRate ?? 0.05;

  const scored = genomes
    .map((genome) => ({ genome, score: score(genome) }))
    .sort((left, right) => right.score - left.score);

  const pick = (): string => {
    let winner = scored[rng.int(scored.length)]!;
    for (let round = 1; round < tournamentSize; round += 1) {
      const contender = scored[rng.int(scored.length)]!;
      if (contender.score > winner.score) {
        winner = contender;
      }
    }
    return winner.genome;
  };

  const next: string[] = scored.slice(0, eliteCount).map((entry) => entry.genome);
  while (next.length < genomes.length) {
    const child = options.codec.crossover(pick(), pick(), rng);
    next.push(options.codec.mutate(child, rng, mutationRate));
  }

  const scores = next.map((genome) => score(genome));
  const bestIndex = scores.indexOf(Math.max(...scores));
  return {
    genomes: next,
    scores,
    best: { genome: next[bestIndex]!, score: scores[bestIndex]! },
    average: scores.reduce((total, value) => total + value, 0) / scores.length,
    generation: 1,
  };
}

/** A founding population of random genomes, all the same length. */
export function createFoundingPopulation(
  size: number,
  genomeLength: number,
  codec: GenomeCodec,
  rng: Rng = createRng("founders"),
): string[] {
  if (size < 1 || genomeLength < 1) {
    throw new Error("createFoundingPopulation needs a positive size and genome length");
  }
  return Array.from({ length: size }, () => codec.random(rng, genomeLength));
}
