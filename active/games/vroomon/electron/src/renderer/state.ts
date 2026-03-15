import {
  type AppModeId,
  type RunStateSnapshot,
} from "../shared/parity-contract.js";
import { type GenerationResult } from "../core/population.js";

export interface RendererState {
  mode: AppModeId;
  draftDna: string;
  runState: RunStateSnapshot;
  lastEvaluatedRunState: RunStateSnapshot | null;
  latestGeneration: GenerationResult | null;
  selectedVehicleId: string | null;
  statusMessage: string;
  lastSavedPath: string | null;
}

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
    statusMessage: "Ready to begin the Electron rewrite preview.",
    lastSavedPath: null,
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
        : "Viewing test-drive mode.";

  return {
    ...state,
    mode,
    runState:
      mode === "menu"
        ? state.runState
         : {
             ...state.runState,
             mode,
           },
    statusMessage: modeStatusMessage,
  };
}

export function setRendererTerrain(
  state: RendererState,
  terrainName: string,
): RendererState {
  return {
    ...clearEvaluatedGenerationState(state),
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

export function setDraftDna(
  state: RendererState,
  draftDna: string,
): RendererState {
  return {
    ...state,
    draftDna,
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

  return {
    ...state,
    mode: "evolution",
    lastEvaluatedRunState: state.runState,
    runState: nextRunState,
    latestGeneration: generationResult,
    selectedVehicleId,
    statusMessage: `Completed generation ${state.runState.generation + 1}.`,
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

function clearEvaluatedGenerationState(state: RendererState): RendererState {
  return {
    ...state,
    lastEvaluatedRunState: null,
    latestGeneration: null,
    selectedVehicleId: null,
  };
}
