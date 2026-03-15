import { createRandomDna } from "../shared/dna-v2.js";
import {
  DEFAULT_RUN_CONFIG,
  type PopulationEntry,
  type RunConfig,
  type RunStateSnapshot,
} from "../shared/parity-contract.js";

const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export interface ScoreStats {
  count: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
}

export interface ParentPairSample {
  firstParentId: string;
  secondParentId: string;
}

export interface BreedingSummary {
  survivorCount: number;
  childCount: number;
  parentUsage: Record<string, number>;
  samplePairs: ParentPairSample[];
}

export interface EvolutionPreview {
  population: PopulationEntry[];
  breeding: BreedingSummary;
}

export function createInitialPopulation(
  runId: string,
  config: Pick<RunConfig, "populationSize" | "dnaLength"> = DEFAULT_RUN_CONFIG,
  random: () => number = Math.random,
): PopulationEntry[] {
  const population: PopulationEntry[] = [];

  for (let index = 0; index < config.populationSize; index += 1) {
    const dnaLength = randomInt(
      Math.max(3, config.dnaLength - 4),
      config.dnaLength + 4,
      random,
    );
    population.push({
      id: formatPopulationId(runId, index + 1),
      dna: createRandomDna(dnaLength, random),
      parents: [],
      mutated: false,
      score: 0,
    });
  }

  return population;
}

export function computeScoreStats(scores: number[]): ScoreStats | undefined {
  if (scores.length === 0) {
    return undefined;
  }

  const sortedScores = [...scores].sort((left, right) => left - right);
  const count = sortedScores.length;
  const mean = sortedScores.reduce((sum, score) => sum + score, 0) / count;
  const median =
    (sortedScores[Math.floor(count / 2)]! +
      sortedScores[Math.floor((count - 1) / 2)]!) /
    2;
  const q1 = sortedScores[Math.floor((count - 1) * 0.25)]!;
  const q3 = sortedScores[Math.floor((count - 1) * 0.75)]!;

  return {
    count,
    mean,
    median,
    q1,
    q3,
    min: sortedScores[0]!,
    max: sortedScores[count - 1]!,
  };
}

export function previewEvolutionStep(
  population: PopulationEntry[],
  retainRatio: number,
  mutationRate: number,
  runId: string,
  random: () => number = Math.random,
): EvolutionPreview {
  const survivorCount = Math.max(2, Math.floor(population.length * retainRatio));
  const scoredPopulation = [...population].sort((left, right) => right.score - left.score);
  const survivors = scoredPopulation.slice(0, survivorCount);
  const children: PopulationEntry[] = [];
  const parentUsage: Record<string, number> = Object.fromEntries(
    survivors.map((survivor) => [survivor.id, 0]),
  );
  const samplePairs: ParentPairSample[] = [];
  let nextId = population.length + 1;

  while (survivors.length + children.length < population.length) {
    const firstParent = pickRandom(survivors, random);
    const secondParent = pickDistinctRandom(survivors, firstParent.id, random);
    const shouldMutate = random() < mutationRate;
    const childDna = shouldMutate
      ? mutateDna(crossoverDna(firstParent.dna, secondParent.dna, random), random)
      : crossoverDna(firstParent.dna, secondParent.dna, random);

    parentUsage[firstParent.id] = (parentUsage[firstParent.id] ?? 0) + 1;
    parentUsage[secondParent.id] = (parentUsage[secondParent.id] ?? 0) + 1;

    if (samplePairs.length < 8) {
      samplePairs.push({
        firstParentId: firstParent.id,
        secondParentId: secondParent.id,
      });
    }

    children.push({
      id: formatPopulationId(runId, nextId),
      dna: childDna,
      parents: [firstParent.id, secondParent.id],
      mutated: shouldMutate,
      score: 0,
    });
    nextId += 1;
  }

  return {
    population: [...survivors, ...children],
    breeding: {
      survivorCount: survivors.length,
      childCount: children.length,
      parentUsage,
      samplePairs,
    },
  };
}

export function createPreviewRunState(
  runId: string,
  baseState: RunStateSnapshot,
  random: () => number = Math.random,
): RunStateSnapshot {
  return {
    ...baseState,
    population: createInitialPopulation(runId, baseState.config, random),
  };
}

function formatPopulationId(runId: string, sequenceNumber: number): string {
  return `${runId}-${sequenceNumber.toString().padStart(5, "0")}`;
}

function pickRandom<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

function pickDistinctRandom<T extends { id: string }>(
  items: T[],
  excludedId: string,
  random: () => number,
): T {
  let candidate = pickRandom(items, random);
  let attempts = 0;

  while (candidate.id === excludedId && attempts < 10) {
    candidate = pickRandom(items, random);
    attempts += 1;
  }

  return candidate;
}

function crossoverDna(
  firstDna: string,
  secondDna: string,
  random: () => number,
): string {
  const shortestLength = Math.min(firstDna.length, secondDna.length);

  if (shortestLength <= 1) {
    return firstDna;
  }

  const cutPoint = randomInt(1, shortestLength - 1, random);
  return `${firstDna.slice(0, cutPoint)}${secondDna.slice(cutPoint)}`;
}

function mutateDna(dna: string, random: () => number): string {
  if (dna.length === 0) {
    return createRandomDna(1, random);
  }

  const index = randomInt(0, dna.length - 1, random);
  const replacement =
    BASE62_ALPHABET[randomInt(0, BASE62_ALPHABET.length - 1, random)]!;

  return `${dna.slice(0, index)}${replacement}${dna.slice(index + 1)}`;
}

function randomInt(
  min: number,
  max: number,
  random: () => number,
): number {
  return Math.floor(random() * (max - min + 1)) + min;
}
