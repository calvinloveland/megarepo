import {
  type AppModeId,
  type HallOfFame,
  type HallOfFameEntry,
  type RunConfig,
  type RunStateSnapshot,
} from "../shared/parity-contract.js";
import { type GenerationResult } from "../core/population.js";
import { type WorldState } from "./world/types.js";
import { createInitialWorldState } from "./world/world-state.js";

export interface ScoreHistoryEntry {
  generation: number;
  bestScore: number;
  meanScore: number;
  populationSize: number;
}

export interface RendererState {
  mode: AppModeId;
  draftDna: string;
  runState: RunStateSnapshot;
  lastEvaluatedRunState: RunStateSnapshot | null;
  latestGeneration: GenerationResult | null;
  selectedVehicleId: string | null;
  testDriveStepCount: number;
  testDriveFrameCount: number;
  testDrivePlaybackDurationMs: number | null;
  testDriveScenarioLabel: string | null;
  statusMessage: string;
  lastSavedPath: string | null;
  batchCount: number;
  batchRunning: boolean;
  batchCompleted: number;
  scoreHistory: ScoreHistoryEntry[];
  convergeMode: boolean;
  hallOfFame: HallOfFame;
  selectedHallEntryId: string | null;
  world: WorldState;
}

export const DEFAULT_TEST_DRIVE_STEP_COUNT = 360;
export const DEFAULT_TEST_DRIVE_FRAME_COUNT = 60;
// The evolution viewport races a small highlighted pack. Longer step counts
// give the cars time to actually separate; higher frame counts give the
// rAF interpolator denser physics samples to tween between.
export const DEFAULT_EVOLUTION_VIEWPORT_STEP_COUNT = 360;
export const DEFAULT_EVOLUTION_VIEWPORT_FRAME_COUNT = 60;
export const DEFAULT_BATCH_GENERATION_COUNT = 10;

const BATCH_COUNT_OPTIONS = [5, 10, 25, 50, 100];
export { BATCH_COUNT_OPTIONS };

export interface SelectedVehicleSummary {
  id: string;
  dna: string;
  score: number;
  parents: string[];
  mutated: boolean;
  children: string[];
}

export function createRendererState(
  initialRunState: RunStateSnapshot,
  draftDna: string,
): RendererState {
  return {
    mode: "menu",
    draftDna,
    runState: initialRunState,
    lastEvaluatedRunState: null,
    latestGeneration: null,
    selectedVehicleId: null,
    testDriveStepCount: DEFAULT_TEST_DRIVE_STEP_COUNT,
    testDriveFrameCount: DEFAULT_TEST_DRIVE_FRAME_COUNT,
    testDrivePlaybackDurationMs: null,
    testDriveScenarioLabel: null,
    statusMessage: "Ready to begin the Electron rewrite preview.",
    lastSavedPath: null,
    batchCount: DEFAULT_BATCH_GENERATION_COUNT,
    batchRunning: false,
    batchCompleted: 0,
    scoreHistory: [],
    convergeMode: true,
    hallOfFame: { version: 1, entries: [] },
    selectedHallEntryId: null,
    world: createInitialWorldState(),
  };
}

export function setRendererMode(
  state: RendererState,
  mode: AppModeId,
): RendererState {
  const modeStatusMessage =
    mode === "menu"
      ? "Viewing the main menu."
      : mode === "evolution"
        ? "Viewing evolution mode."
        : mode === "test-drive"
          ? "Viewing test-drive mode."
          : "Exploring the Continent of Vroom.";

  const runStateMode: "evolution" | "test-drive" =
    mode === "test-drive" ? "test-drive" : "evolution";

  return {
    ...state,
    mode,
    runState:
      mode === "menu" || mode === "world"
        ? state.runState
        : {
            ...state.runState,
            mode: runStateMode,
          },
    statusMessage: modeStatusMessage,
  };
}

export function setRendererTerrain(
  state: RendererState,
  terrainName: string,
): RendererState {
  return {
    ...resetTestDriveReplay(clearEvaluatedGenerationState(state)),
    runState: {
      ...state.runState,
      terrainName,
    },
    statusMessage: `Switched terrain to ${terrainName}.`,
  };
}

export function setRendererRunState(
  state: RendererState,
  runState: RunStateSnapshot,
  statusMessage: string,
): RendererState {
  return {
    ...clearEvaluatedGenerationState(state),
    mode: runState.mode,
    runState,
    statusMessage,
  };
}

export function setRunConfig(
  state: RendererState,
  patch: Partial<RunConfig>,
): RendererState {
  return {
    ...clearEvaluatedGenerationState(state),
    runState: {
      ...state.runState,
      config: { ...state.runState.config, ...patch },
    },
    statusMessage: "Run config updated. Generate a new population to apply.",
  };
}

export function setDraftDna(
  state: RendererState,
  draftDna: string,
): RendererState {
  return {
    ...resetTestDriveReplay(state),
    draftDna,
  };
}

export function setTestDriveReplay(
  state: RendererState,
  options: {
    dna: string;
    terrainName: string;
    stepCount: number;
    frameCount: number;
    playbackDurationMs: number | null;
    label: string;
    statusMessage: string;
  },
): RendererState {
  return {
    ...resetTestDriveReplay(clearEvaluatedGenerationState(state)),
    mode: "test-drive",
    draftDna: options.dna,
    runState: {
      ...state.runState,
      mode: "test-drive",
      terrainName: options.terrainName,
    },
    testDriveStepCount: options.stepCount,
    testDriveFrameCount: options.frameCount,
    testDrivePlaybackDurationMs: options.playbackDurationMs,
    testDriveScenarioLabel: options.label,
    statusMessage: options.statusMessage,
  };
}

export function applyGenerationToState(
  state: RendererState,
  generationResult: GenerationResult,
  nextRunState: RunStateSnapshot,
): RendererState {
  const selectedVehicleId =
    generationResult.evaluatedPopulation
      .slice()
      .sort((left, right) => right.score - left.score)[0]?.id ?? null;
  const bestScore = Math.max(0, ...generationResult.evaluation.results.map((r) => r.score));
  const meanScore = generationResult.evaluation.stats?.mean ?? 0;
  const scoreEntry: ScoreHistoryEntry = {
    generation: nextRunState.generation,
    bestScore,
    meanScore,
    populationSize: generationResult.evaluatedPopulation.length,
  };

  return {
    ...state,
    mode: "evolution",
    lastEvaluatedRunState: state.runState,
    runState: nextRunState,
    latestGeneration: generationResult,
    selectedVehicleId,
    statusMessage: `Completed generation ${state.runState.generation + 1}.`,
    scoreHistory: [...state.scoreHistory, scoreEntry],
  };
}

export function selectVehicle(
  state: RendererState,
  vehicleId: string,
): RendererState {
  return {
    ...state,
    selectedVehicleId: vehicleId,
  };
}

export function setSavedPath(
  state: RendererState,
  savePath: string,
): RendererState {
  return {
    ...state,
    lastSavedPath: savePath,
    statusMessage: `Saved run state to ${savePath}.`,
  };
}

export function getSelectedVehicleSummary(
  state: RendererState,
): SelectedVehicleSummary | null {
  if (!state.selectedVehicleId || !state.latestGeneration) {
    return null;
  }

  const vehicle = state.latestGeneration.evaluatedPopulation.find(
    (entry) => entry.id === state.selectedVehicleId,
  );

  if (!vehicle) {
    return null;
  }

  return {
    id: vehicle.id,
    dna: vehicle.dna,
    score: vehicle.score,
    parents: vehicle.parents,
    mutated: vehicle.mutated,
    children: state.runState.genealogy[vehicle.id] ?? [],
  };
}

export function setBatchCount(
  state: RendererState,
  batchCount: number,
): RendererState {
  return {
    ...state,
    batchCount,
  };
}

export function setBatchRunning(
  state: RendererState,
  running: boolean,
): RendererState {
  return {
    ...state,
    batchRunning: running,
    batchCompleted: running ? 0 : state.batchCompleted,
  };
}

export function updateBatchProgress(
  state: RendererState,
  completed: number,
  statusMessage: string,
): RendererState {
  return {
    ...state,
    batchCompleted: completed,
    statusMessage,
  };
}

export function setConvergeMode(
  state: RendererState,
  convergeMode: boolean,
): RendererState {
  return {
    ...state,
    convergeMode,
  };
}

export function setHallOfFame(
  state: RendererState,
  hall: HallOfFame,
): RendererState {
  return {
    ...state,
    hallOfFame: hall,
  };
}

export function setWorldState(
  state: RendererState,
  world: WorldState,
): RendererState {
  return {
    ...state,
    world,
  };
}

export function resetWorldState(state: RendererState): RendererState {
  return {
    ...state,
    world: createInitialWorldState(),
  };
}

export function addHallOfFameEntry(
  state: RendererState,
  entry: HallOfFameEntry,
): RendererState {
  const entries = [entry, ...state.hallOfFame.entries];
  return {
    ...state,
    hallOfFame: { version: 1, entries: entries.slice(0, 50) },
    selectedHallEntryId: entry.id,
  };
}

export function removeHallOfFameEntry(
  state: RendererState,
  entryId: string,
): RendererState {
  return {
    ...state,
    hallOfFame: {
      version: 1,
      entries: state.hallOfFame.entries.filter((entry) => entry.id !== entryId),
    },
    selectedHallEntryId:
      state.selectedHallEntryId === entryId ? null : state.selectedHallEntryId,
  };
}

export interface RenameResult {
  state: RendererState;
  ok: boolean;
  reason?: string;
}

export function renameHallOfFameEntry(
  state: RendererState,
  entryId: string,
  newName: string,
): RenameResult {
  const trimmed = newName.trim();

  if (trimmed.length === 0) {
    return { state, ok: false, reason: "Name cannot be empty." };
  }

  const target = state.hallOfFame.entries.find((entry) => entry.id === entryId);

  if (!target) {
    return { state, ok: false, reason: "Entry not found." };
  }

  if (target.name === trimmed) {
    return { state, ok: false, reason: "Name unchanged." };
  }

  if (state.runState.wallet < 1) {
    return { state, ok: false, reason: "Need 1 credit to rename." };
  }

  const updatedEntries = state.hallOfFame.entries.map((entry) =>
    entry.id === entryId ? { ...entry, name: trimmed } : entry,
  );

  return {
    state: {
      ...state,
      hallOfFame: { version: 1, entries: updatedEntries },
      runState: { ...state.runState, wallet: state.runState.wallet - 1 },
    },
    ok: true,
  };
}

export function selectHallEntry(
  state: RendererState,
  entryId: string | null,
): RendererState {
  return {
    ...state,
    selectedHallEntryId: entryId,
  };
}

export function detectConvergence(
  history: ScoreHistoryEntry[],
  windowSize = 3,
  thresholdRatio = 0.02,
): { converged: boolean; message: string } {
  if (history.length < windowSize + 1) {
    return { converged: false, message: "Not enough generations to detect convergence." };
  }

  const recentScores = history.slice(-windowSize).map((entry) => entry.bestScore);
  const mean = recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length;

  if (mean === 0) {
    return { converged: false, message: "No scores recorded yet." };
  }

  const variance =
    recentScores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / recentScores.length;
  const cv = Math.sqrt(variance) / mean;

  if (cv < thresholdRatio) {
    const latestGen = history[history.length - 1]?.generation ?? 0;
    return {
      converged: true,
      message: `Scores plateaued at gen ${latestGen} (CV=${(cv * 100).toFixed(1)}% below ${(thresholdRatio * 100).toFixed(0)}% threshold).`,
    };
  }

  return { converged: false, message: `Active evolution (CV=${(cv * 100).toFixed(1)}%).` };
}

export function applyBatchGeneration(
  state: RendererState,
  generationResult: GenerationResult,
  nextRunState: RunStateSnapshot,
  completedGenerations: number,
  totalGenerations: number,
): RendererState {
  const selectedVehicleId =
    generationResult.evaluatedPopulation
      .slice()
      .sort((left, right) => right.score - left.score)[0]?.id ?? null;
  const bestScore = Math.max(0, ...generationResult.evaluation.results.map((r) => r.score));
  const meanScore = generationResult.evaluation.stats?.mean ?? 0;
  const scoreEntry: ScoreHistoryEntry = {
    generation: nextRunState.generation,
    bestScore,
    meanScore,
    populationSize: generationResult.evaluatedPopulation.length,
  };

  return {
    ...state,
    mode: "evolution",
    lastEvaluatedRunState: state.runState,
    runState: nextRunState,
    latestGeneration: generationResult,
    selectedVehicleId,
    batchCompleted: completedGenerations,
    statusMessage: `Batch progress: ${completedGenerations}/${totalGenerations} generations (completed gen ${nextRunState.generation}).`,
    scoreHistory: [...state.scoreHistory, scoreEntry],
  };
}

function clearEvaluatedGenerationState(state: RendererState): RendererState {
  return {
    ...state,
    lastEvaluatedRunState: null,
    latestGeneration: null,
    selectedVehicleId: null,
  };
}

function resetTestDriveReplay(state: RendererState): RendererState {
  return {
    ...state,
    testDriveStepCount: DEFAULT_TEST_DRIVE_STEP_COUNT,
    testDriveFrameCount: DEFAULT_TEST_DRIVE_FRAME_COUNT,
    testDrivePlaybackDurationMs: null,
    testDriveScenarioLabel: null,
  };
}
