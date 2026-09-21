// The wild, evolving on its own.
//
// A ranch herd is bred with intent: the rancher picks the retain ratio, arms
// the stud line, culls the slow and answers to a bar. Wild vroomon answer to
// nothing but the ground they live on — the terrain is the only selector, and
// nobody is steering the mutation rate.
//
// Each biome keeps a PACK of wild vroomon. Every time you cross paths with
// one the pack turns over a generation: the fastest half breed, a couple of
// wanderers join, and the rest are eaten by the road. That is why the wild
// gets harder as you play, and why catching one is only worth anything once
// your own herd is better than the ground it came off.

import { createRandomDna } from "../shared/dna-v2.js";
import { evaluatePopulation } from "./population.js";

/** The terrain a biome's wild vroomon are selected on. */
const WILD_TERRAIN_BY_MAP: Record<string, string> = {
  ranch_yard: "Grassland",
  marrow_orchard: "Grassland",
  long_haul: "Sand",
  route_1: "Grassland",
  route_2: "Sand",
  gym_1: "Grassland",
  gym_2: "Sand",
  hills_map: "Hills",
  rocky_map: "Rocky",
  ice_map: "Ice",
  starter_town: "Flat",
};

export const WILD_PACK_SIZE = 24;
/** Nobody in charge: the wild mutates far more freely than a tended herd. */
const WILD_MUTATION_RATE = 0.55;
const WILD_SURVIVOR_SHARE = 0.5;
/** Wanderers drifting in from elsewhere, so the pack never converges. */
const WILD_IMMIGRANTS = 4;

export function wildTerrainFor(mapId: string): string {
  return WILD_TERRAIN_BY_MAP[mapId] ?? "Grassland";
}

function hashSeed(text: string): () => number {
  let state = 0;
  for (const char of text) {
    state = (state * 31 + char.charCodeAt(0)) % 4294967296;
  }
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh pack for a biome: deterministic, so a new save always meets the
 * same founders on the same ground. */
export function seedWildPack(mapId: string, size = WILD_PACK_SIZE): string[] {
  const random = hashSeed(`wild:${mapId}`);
  return Array.from({ length: size }, () => createRandomDna(12, random));
}

function crossoverDna(first: string, second: string, random: () => number): string {
  const shortest = Math.min(first.length, second.length);
  if (shortest <= 1) {
    return first;
  }
  const cut = 1 + Math.floor(random() * (shortest - 1));
  return `${first.slice(0, cut)}${second.slice(cut)}`;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function mutateDna(dna: string, random: () => number): string {
  if (dna.length === 0) {
    return createRandomDna(1, random);
  }
  const index = Math.floor(random() * dna.length);
  const replacement = ALPHABET[Math.floor(random() * ALPHABET.length)]!;
  return `${dna.slice(0, index)}${replacement}${dna.slice(index + 1)}`;
}

export interface WildPack {
  mapId: string;
  terrain: string;
  /** Pack members, best first once scored. */
  members: Array<{ dna: string; score: number }>;
  /** The best animal on this ground — what the pack is capable of. */
  champion: { dna: string; score: number };
  /**
   * The one you actually meet: a middling member, not the alpha.
   *
   * Meeting the champion every time made the wild a wall — and worse, it made
   * the tutorial's first catch unwinnable, because Robby's loaner is slower
   * than a selected pack's best. A wild vroomon in the grass is a specimen of
   * its ground, so the middle of the pack is what turns up; it still rises as
   * the pack does, which is the arms race that matters.
   */
  representative: { dna: string; score: number };
}

/** Score a pack on its own terrain. */
export function scoreWildPack(mapId: string, pack: string[]): WildPack {
  const terrain = wildTerrainFor(mapId);
  const evaluation = evaluatePopulation(
    pack.map((dna, index) => ({
      id: `wild-${index}`,
      dna,
      parents: [],
      mutated: false,
      score: 0,
    })),
    terrain,
  );
  const members = pack
    .map((dna, index) => ({ dna, score: evaluation.results[index]?.score ?? 0 }))
    .sort((left, right) => right.score - left.score);

  const none = { dna: pack[0] ?? "0", score: 0 };
  return {
    mapId,
    terrain,
    members,
    champion: members[0] ?? none,
    representative: members[Math.floor(members.length / 2)] ?? none,
  };
}

/**
 * One turn of the wild's wheel: the fastest breed, wanderers arrive, the rest
 * are gone. No retain ratio, no stud line, no culls — just the ground.
 */
export function advanceWildPack(
  mapId: string,
  pack: string[],
  random: () => number,
  /** A ranking already computed for this exact pack, to avoid re-racing it. */
  prescored?: WildPack,
): { pack: string[]; champion: { dna: string; score: number }; terrain: string } {
  const scored =
    prescored && prescored.members.length === pack.length ? prescored : scoreWildPack(mapId, pack);
  const survivors = scored.members.slice(
    0,
    Math.max(2, Math.floor(scored.members.length * WILD_SURVIVOR_SHARE)),
  );
  // The pack's best are still out there: survivors are carried over, not
  // replaced by their own children, so the wild never gets EASIER over time.
  // Without this the champion's score wandered up and down (measured: 804,
  // 1143, 1386, then 1153, 1028, 599) as the breeding pool was rebuilt from
  // scratch every generation.
  const next: string[] = survivors.slice(0, 2).map((member) => member.dna);

  while (next.length < Math.max(2, pack.length - WILD_IMMIGRANTS)) {
    const first = survivors[Math.floor(random() * survivors.length)]!.dna;
    const second = survivors[Math.floor(random() * survivors.length)]!.dna;
    const child = crossoverDna(first, second, random);
    next.push(random() < WILD_MUTATION_RATE ? mutateDna(child, random) : child);
  }
  while (next.length < pack.length) {
    next.push(createRandomDna(12, random));
  }

  const advanced = scoreWildPack(mapId, next);
  return { pack: next, champion: advanced.champion, terrain: advanced.terrain };
}

/**
 * The pack that greets you, evolved forward to `generations` — used when a
 * save has a pack from an older shape, or when a map is visited for the first
 * time. Cheap enough for a handful of generations.
 */
export function wildPackAt(
  mapId: string,
  generations: number,
  basePack?: string[],
): WildPack {
  let pack = basePack && basePack.length > 0 ? basePack : seedWildPack(mapId);
  const random = hashSeed(`advance:${mapId}:${generations}:${pack.length}`);
  for (let step = 0; step < Math.max(0, generations); step += 1) {
    pack = advanceWildPack(mapId, pack, random).pack;
  }
  return scoreWildPack(mapId, pack);
}
