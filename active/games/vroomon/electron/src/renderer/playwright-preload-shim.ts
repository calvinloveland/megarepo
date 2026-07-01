import {
  cleanDna,
  createRandomDna,
  decodeDnaV2,
  type DecodedDnaV2,
} from "../shared/dna-v2.js";
import {
  createEmptyRunState,
  getTerrainPreset,
  VROOMON_PARITY_CONTRACT,
  type HallOfFame,
  type RunStateSnapshot,
  type TerrainPresetDefinition,
  type VroomonParityContract,
} from "../shared/parity-contract.js";
import { type PersistedWorldState } from "./world/types.js";
import { initializeErrorLogger, getErrorLogger } from "./error-logger.js";

// Initialize error logger on the web so the floating error panel works
// and the user can see what went wrong. Errors also get POSTed to the
// server-side feedback endpoint at /api/feedback.
const FEEDBACK_ENDPOINT =
  (typeof window !== "undefined" && window.location
    ? `${window.location.protocol}//${window.location.host}/api/feedback`
    : "");
initializeErrorLogger({
  debug: false,
  endpoint: FEEDBACK_ENDPOINT,
});

// Wrap any uncaught error from the renderer in our logger so the user
// sees it instead of a blank page.
window.addEventListener("error", (event) => {
  getErrorLogger()?.logMessage(
    `[global] ${event.message ?? "unknown error"}`,
    { filename: event.filename, lineno: event.lineno, colno: event.colno },
  );
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  getErrorLogger()?.logMessage(
    `[promise] ${reason instanceof Error ? reason.message : String(reason)}`,
  );
});
import {
  advanceRunState,
  computeScoreStats,
  createPreviewRunState,
  evaluatePopulation,
  previewEvolutionStep,
  runEvolutionGeneration,
  type EvolutionPreview,
  type GenerationResult,
  type PopulationEvaluation,
  type ScoreStats,
} from "../core/population.js";
import {
  createGenerationLogEntry,
  type GenerationLogEntry,
} from "../core/persistence.js";
import {
  createMatterVehicle,
  simulateMatterVehicleFrames,
  simulatePopulationRace,
  simulatePopulationRaceFrames,
  stepMatterVehicle,
  type RacePreviewFrame,
  type RaceVehicleSnapshot,
  type VehiclePreviewFrame,
  type VehicleSnapshot,
} from "../simulation/matter-simulation.js";

declare global {
  interface Window {
    vroomon: {
      cleanDna: (dna: string) => string;
      createRandomDna: (length?: number) => string;
      decodeDnaV2: (dna: string) => DecodedDnaV2;
      getParityContract: () => VroomonParityContract;
      getTerrainPreset: (name: string) => TerrainPresetDefinition | undefined;
      createEmptyRunState: (mode: "evolution" | "test-drive") => RunStateSnapshot;
      createPreviewRunState: (
        runId: string,
        baseState?: RunStateSnapshot,
      ) => RunStateSnapshot;
      computeScoreStats: (scores: number[]) => ScoreStats | undefined;
      evaluatePopulation: (state: RunStateSnapshot) => PopulationEvaluation;
      runEvolutionGeneration: (state: RunStateSnapshot) => GenerationResult;
      advanceRunState: (
        state: RunStateSnapshot,
        generationResult: GenerationResult,
      ) => RunStateSnapshot;
      createGenerationLogEntry: (
        state: RunStateSnapshot,
        generationResult: GenerationResult,
      ) => GenerationLogEntry;
      previewEvolutionStep: (state: RunStateSnapshot) => EvolutionPreview;
      previewPhysicsSnapshot: (
        dna: string,
        terrainName: string,
        stepCount?: number,
      ) => VehicleSnapshot;
      previewPhysicsFrames: (
        dna: string,
        terrainName: string,
        stepCount?: number,
        frameCount?: number,
      ) => VehiclePreviewFrame[];
      previewPopulationRace: (
        state: RunStateSnapshot,
        stepCount?: number,
      ) => RaceVehicleSnapshot[];
      previewPopulationRaceFrames: (
        state: RunStateSnapshot,
        stepCount?: number,
        frameCount?: number,
      ) => RacePreviewFrame[];
      saveRunState: (state: RunStateSnapshot) => Promise<string>;
      loadRunState: () => Promise<RunStateSnapshot | null>;
      appendGenerationLog: (entry: GenerationLogEntry) => Promise<string>;
      loadGenerationLog: (runId: string) => Promise<GenerationLogEntry[]>;
      loadHallOfFame: () => Promise<HallOfFame>;
      saveHallOfFame: (hall: HallOfFame) => Promise<string>;
      loadWorldState: () => Promise<PersistedWorldState>;
      saveWorldState: (world: PersistedWorldState) => Promise<string>;
      runBatchGenerations: (
        state: RunStateSnapshot,
        count: number,
      ) => Promise<{
        generationResults: GenerationResult[];
        finalState: RunStateSnapshot;
        logEntries: GenerationLogEntry[];
      }>;
    };
  }
}

let savedRunState: RunStateSnapshot | null = null;
const generationLogs = new Map<string, GenerationLogEntry[]>();
let savedHallOfFame: HallOfFame | null = null;
let savedWorldState: PersistedWorldState | null = null;

window.vroomon = {
  cleanDna,
  createRandomDna,
  decodeDnaV2,
  getParityContract: (): VroomonParityContract => VROOMON_PARITY_CONTRACT,
  getTerrainPreset: (name: string): TerrainPresetDefinition | undefined =>
    getTerrainPreset(name),
  createEmptyRunState: (
    mode: "evolution" | "test-drive",
  ): RunStateSnapshot => createEmptyRunState(mode),
  createPreviewRunState: (
    runId: string,
    baseState: RunStateSnapshot = createEmptyRunState("evolution"),
  ): RunStateSnapshot => createPreviewRunState(runId, baseState),
  computeScoreStats: (scores: number[]): ScoreStats | undefined =>
    computeScoreStats(scores),
  evaluatePopulation: (state: RunStateSnapshot): PopulationEvaluation =>
    evaluatePopulation(state.population, state.terrainName),
  runEvolutionGeneration: (state: RunStateSnapshot): GenerationResult =>
    runEvolutionGeneration(state),
  advanceRunState: (
    state: RunStateSnapshot,
    generationResult: GenerationResult,
  ): RunStateSnapshot => advanceRunState(state, generationResult),
  createGenerationLogEntry: (
    state: RunStateSnapshot,
    generationResult: GenerationResult,
  ): GenerationLogEntry => createGenerationLogEntry(state, generationResult),
  previewEvolutionStep: (state: RunStateSnapshot): EvolutionPreview =>
    previewEvolutionStep(
      state.population,
      state.config.retainRatio,
      state.config.mutationRate,
      state.runId,
      state.genealogy,
    ),
  previewPhysicsSnapshot: (
    dna: string,
    terrainName: string,
    stepCount = 120,
  ): VehicleSnapshot =>
    stepMatterVehicle(createMatterVehicle(dna, terrainName), stepCount),
  previewPhysicsFrames: (
    dna: string,
    terrainName: string,
    stepCount = 120,
    frameCount = 24,
  ): VehiclePreviewFrame[] =>
    simulateMatterVehicleFrames(dna, terrainName, { stepCount, frameCount }),
  previewPopulationRace: (
    state: RunStateSnapshot,
    stepCount = 180,
  ): RaceVehicleSnapshot[] =>
    simulatePopulationRace(
      state.population.map((entry) => ({ id: entry.id, dna: entry.dna })),
      state.terrainName,
      { stepCount },
    ),
  previewPopulationRaceFrames: (
    state: RunStateSnapshot,
    stepCount = 180,
    frameCount = 24,
  ): RacePreviewFrame[] =>
    simulatePopulationRaceFrames(
      state.population.map((entry) => ({ id: entry.id, dna: entry.dna })),
      state.terrainName,
      { stepCount, frameCount },
    ),
  saveRunState: async (state: RunStateSnapshot): Promise<string> => {
    savedRunState = structuredClone(state);
    return "memory://vroomon/save-state.json";
  },
  loadRunState: async (): Promise<RunStateSnapshot | null> =>
    savedRunState ? structuredClone(savedRunState) : null,
  appendGenerationLog: async (entry: GenerationLogEntry): Promise<string> => {
    const entries = generationLogs.get(entry.runId) ?? [];
    generationLogs.set(entry.runId, [...entries, entry]);
    return `memory://vroomon/logs/${entry.runId}.jsonl`;
  },
  loadGenerationLog: async (runId: string): Promise<GenerationLogEntry[]> =>
    structuredClone(generationLogs.get(runId) ?? []),
  loadHallOfFame: async (): Promise<HallOfFame> =>
    savedHallOfFame ? structuredClone(savedHallOfFame) : { version: 1, entries: [] },
  saveHallOfFame: async (hall: HallOfFame): Promise<string> => {
    savedHallOfFame = structuredClone(hall);
    return "memory://vroomon/hall-of-fame.json";
  },
  loadWorldState: async (): Promise<PersistedWorldState> =>
    savedWorldState
      ? structuredClone(savedWorldState)
      : {
          version: 1,
          currentMapId: "starter_town",
          playerX: 7,
          playerY: 7,
          playerFacing: "down",
          badges: [],
          vroomdex: [],
          flags: {},
          lastSavedAt: "",
        },
  saveWorldState: async (world: PersistedWorldState): Promise<string> => {
    savedWorldState = structuredClone(world);
    return "memory://vroomon/world-state.json";
  },
  runBatchGenerations: async (
    state: RunStateSnapshot,
    count: number,
  ): Promise<{
    generationResults: GenerationResult[];
    finalState: RunStateSnapshot;
    logEntries: GenerationLogEntry[];
  }> => {
    let currentState = state;
    const generationResults: GenerationResult[] = [];
    const logEntries: GenerationLogEntry[] = [];

    for (let index = 0; index < count; index += 1) {
      const result = runEvolutionGeneration(currentState);
      currentState = advanceRunState(currentState, result);
      generationResults.push(result);
      logEntries.push(createGenerationLogEntry(currentState, result));
    }

    return { generationResults, finalState: currentState, logEntries };
  },
};
