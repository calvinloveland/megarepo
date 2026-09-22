/**
 * Deterministic randomness.
 *
 * Everything generated — mazes, wild packs, breeding, weather — takes an `Rng`
 * instead of reaching for `Math.random`. A seed then reproduces the same world
 * on every machine, which is the difference between "the maze looks wrong" and
 * "the maze at seed 12 has an unreachable pocket".
 */

export interface Rng {
  /** The resolved 32-bit seed, so a save can record what built the world. */
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Returns 0 for an empty range. */
  int(maxExclusive: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** True with the given probability (default a coin flip). */
  bool(chance?: number): boolean;
  /** One element; throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /** A new shuffled array; the input is left alone. */
  shuffle<T>(items: readonly T[]): T[];
  /** A stream derived from this one, so a sub-generator cannot perturb the parent. */
  fork(label: string): Rng;
}

/** FNV-1a over the seed's characters, so string seeds are stable across runs. */
export function hashSeed(seed: string | number): number {
  if (typeof seed === "number") {
    return seed >>> 0;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and good enough for content generation. */
export function createRng(seed: string | number = 1): Rng {
  const resolved = hashSeed(seed);
  let state = resolved;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed: resolved,
    next,
    int: (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive)),
    range: (min, max) => min + next() * (max - min),
    bool: (chance = 0.5) => next() < chance,
    pick: (items) => {
      if (items.length === 0) {
        throw new Error("createRng().pick() called with an empty list");
      }
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle: (items) => {
      const out = [...items];
      for (let index = out.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        const value = out[index]!;
        out[index] = out[swap]!;
        out[swap] = value;
      }
      return out;
    },
    fork: (label) => createRng(`${resolved}:${label}`),
  };
}
