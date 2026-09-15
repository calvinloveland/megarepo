import { createRandomDna } from "../shared/dna-v2.js";
import { simulatePopulationRace } from "../simulation/matter-simulation.js";
import { effectiveRunConfig, incomeMultiplier } from "./economy.js";
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
  genealogy: Record<string, string[]>;
}

export interface VehicleEvaluation {
  id: string;
  dna: string;
  score: number;
  initialCenterX: number;
  finalCenterX: number;
  initialCenterY: number;
  finalCenterY: number;
  chassisCount: number;
  wheelCount: number;
}

export interface PopulationEvaluation {
  terrainName: string;
  results: VehicleEvaluation[];
  stats?: ScoreStats;
}

export interface GenerationResult {
  evaluatedPopulation: PopulationEntry[];
  evaluation: PopulationEvaluation;
  breeding: BreedingSummary;
  nextPopulation: PopulationEntry[];
  nextGenealogy: Record<string, string[]>;
  /** Supplements drained by this cycle (calm/wild). */
  suppliesConsumed: { calm: number; wild: number };
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
  genealogy: Record<string, string[]> = seedGenealogy(population),
  random: () => number = Math.random,
  studLine: string[] = [],
): EvolutionPreview {
  const survivorCount = Math.max(2, Math.floor(population.length * retainRatio));
  const scoredPopulation = [...population].sort((left, right) => right.score - left.score);
  const survivors = scoredPopulation.slice(0, survivorCount);
  const stud = new Set(studLine);
  const studSurvivors = survivors.filter((survivor) => stud.has(survivor.id));
  const children: PopulationEntry[] = [];
  const nextGenealogy = structuredClone(genealogy);
  const parentUsage: Record<string, number> = Object.fromEntries(
    survivors.map((survivor) => [survivor.id, 0]),
  );
  const samplePairs: ParentPairSample[] = [];
  let nextId = population.length + 1;

  const pickStud = (): boolean =>
    studSurvivors.length > 0 && random() < 0.66;
  while (survivors.length + children.length < population.length) {
    const firstParent = pickStud()
      ? pickRandom(studSurvivors, random)
      : pickRandom(survivors, random);
    const secondParent =
      studSurvivors.length >= 2 && firstParent && stud.has(firstParent.id) && random() < 0.66
        ? pickDistinctRandom(studSurvivors, firstParent.id, random)
        : pickDistinctRandom(survivors, firstParent.id, random);
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
    const childId = formatPopulationId(runId, nextId);
    nextGenealogy[firstParent.id] = [...(nextGenealogy[firstParent.id] ?? []), childId];
    nextGenealogy[secondParent.id] = [...(nextGenealogy[secondParent.id] ?? []), childId];
    nextGenealogy[childId] = nextGenealogy[childId] ?? [];
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
    genealogy: nextGenealogy,
  };
}

export function createPreviewRunState(
  runId: string,
  baseState: RunStateSnapshot,
  random: () => number = Math.random,
): RunStateSnapshot {
  // Ranch upgrades bend the herd's starting config (pasture cap, grazing
  // retain, grooming mutation, velodrome race length). The EFFECTIVE config
  // sizes the new population but is never baked back into storage — base
  // config stays the user-picked one, so repeated generates don't compound
  // upgrade bonuses.
  const config = effectiveRunConfig(baseState.config, baseState.upgrades);
  const population = createInitialPopulation(runId, config, random);

  return {
    ...baseState,
    config: baseState.config,
    runId,
    population,
    genealogy: seedGenealogy(population),
  };
}

/** BFS ancestors for a car, newest-first (parents, then grandparents, ...),
 * up to `depth` generations. Names aren't tracked in the sim, so the UI
 * resolves ids against the Record Barn + current herd. */
/** Plant an imported genome into the herd: the top seed of the population
 * (highest-ranked, or simply entry 0 on a fresh generated herd) takes the
 * given DNA so evolution can breed from a shared champion string. */
/** Release vroomon from the herd: they leave the carrier and return the
 * feed they'd have eaten, so culling the slow pays for breeding the fast. */
export function releaseFromPopulation(
  population: PopulationEntry[],
  ids: string[],
): { population: PopulationEntry[]; feed: number } {
  const releaseSet = new Set(ids);
  return {
    population: population.filter((entry) => !releaseSet.has(entry.id)),
    feed: ids.length,
  };
}

/** Keep only the fastest `keepCount` (by score), releasing the rest. */
export function keepFastest(
  population: PopulationEntry[],
  keepCount: number,
): { kept: PopulationEntry[]; released: PopulationEntry[] } {
  const ranked = [...population].sort((left, right) => right.score - left.score);
  const safe = Math.max(1, Math.min(keepCount, population.length));
  const kept = ranked.slice(0, safe);
  const keptIds = new Set(kept.map((entry) => entry.id));
  return { kept, released: population.filter((entry) => !keptIds.has(entry.id)) };
}

export function plantSeedDna(
  population: PopulationEntry[],
  dna: string,
): PopulationEntry[] {
  if (population.length === 0) {
    return [];
  }
  const seedIndex = population.reduce(
    (best, entry, index) => (entry.score > population[best]!.score ? index : best),
    0,
  );
  return population.map((entry, index) =>
    index === seedIndex ? { ...entry, dna } : entry,
  );
}

export function captureLineage(
  population: PopulationEntry[],
  id: string,
  depth = 4,
): string[] {
  const byId = new Map(population.map((entry) => [entry.id, entry]));
  const lineage: string[] = [];
  const visit = (current: string, generationsLeft: number): void => {
    if (generationsLeft <= 0) {
      return;
    }
    for (const parent of byId.get(current)?.parents ?? []) {
      lineage.push(parent);
      visit(parent, generationsLeft - 1);
    }
  };
  visit(id, depth);
  return lineage;
}

export function seedGenealogy(
  population: PopulationEntry[],
): Record<string, string[]> {
  return Object.fromEntries(population.map((entry) => [entry.id, []]));
}

export function evaluatePopulation(
  population: PopulationEntry[],
  terrainName: string,
  options?: {
    stepCount?: number;
    deltaMs?: number;
  },
): PopulationEvaluation {
  const results = simulatePopulationRace(
    population.map((entry) => ({ id: entry.id, dna: entry.dna })),
    terrainName,
    options,
  ).map((result) => ({
    id: result.id,
    dna: result.dna,
    score: scoreVehicle(result.initialCenterX, result.finalCenterX, result.initialCenterY, result.finalCenterY),
    initialCenterX: result.initialCenterX,
    finalCenterX: result.finalCenterX,
    initialCenterY: result.initialCenterY,
    finalCenterY: result.finalCenterY,
    chassisCount: result.chassis.length,
    wheelCount: result.wheels.length,
  }));

  return {
    terrainName,
    results,
    stats: computeScoreStats(results.map((result) => result.score)),
  };
}

export function runEvolutionGeneration(
  state: RunStateSnapshot,
  random: () => number = Math.random,
): GenerationResult {
  const evaluation = evaluatePopulation(state.population, state.terrainName);
  const scoredPopulation = state.population.map((entry) => {
    const vehicleResult = evaluation.results.find((result) => result.id === entry.id);
    return {
      ...entry,
      score: vehicleResult?.score ?? 0,
    };
  });
  // Breeding knobs honour ranch upgrades (grazing retain, grooming mutation)
  // and any stocked supplement: Calm Tonic silences mutation for the cycle,
  // Wild Brome gambles on novelty.
  const effective = effectiveRunConfig(state.config, state.upgrades);
  const supplies = state.supplies ?? { calm: 0, wild: 0 };
  let cycleMutationRate = effective.mutationRate;
  const suppliesConsumed = { calm: 0, wild: 0 };
  if (supplies.calm > 0) {
    cycleMutationRate = 0;
    suppliesConsumed.calm = 1;
  } else if (supplies.wild > 0) {
    cycleMutationRate = Math.min(0.5, cycleMutationRate + 0.15);
    suppliesConsumed.wild = 1;
  }
  const preview = previewEvolutionStep(
    scoredPopulation,
    effective.retainRatio,
    cycleMutationRate,
    state.runId,
    state.genealogy,
    random,
    state.penIds ?? [],
  );

  return {
    evaluatedPopulation: scoredPopulation,
    evaluation,
    breeding: preview.breeding,
    nextPopulation: preview.population,
    nextGenealogy: preview.genealogy,
    suppliesConsumed,
  };
}

export function advanceRunState(
  state: RunStateSnapshot,
  generationResult: GenerationResult,
): RunStateSnapshot {
  const bestScore = Math.max(
    0,
    ...generationResult.evaluation.results.map((result) => result.score),
  );
  const income = Math.floor((bestScore / 50) * incomeMultiplier(state.upgrades));

  const supplies = state.supplies ?? { calm: 0, wild: 0 };
  return {
    ...state,
    generation: state.generation + 1,
    wallet: state.wallet + income,
    population: generationResult.nextPopulation,
    genealogy: generationResult.nextGenealogy,
    feed: Math.max(0, (state.feed ?? 8) - 1),
    supplies: {
      calm: Math.max(0, supplies.calm - (generationResult.suppliesConsumed.calm ?? 0)),
      wild: Math.max(0, supplies.wild - (generationResult.suppliesConsumed.wild ?? 0)),
    },
    penIds: state.penIds ?? [],
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

function scoreVehicle(
  initialCenterX: number,
  finalCenterX: number,
  initialCenterY: number,
  finalCenterY: number,
): number {
  const distanceTravelled = Math.max(0, finalCenterX - initialCenterX);
  const heightDelta = initialCenterY - finalCenterY;
  const survivalBonus = Math.max(0, -heightDelta * 0.5);
  const fellTooFar = finalCenterY > 600;

  return (fellTooFar ? distanceTravelled * 0.1 : distanceTravelled) + survivalBonus;
}
