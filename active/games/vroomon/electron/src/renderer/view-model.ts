import { type RunStateSnapshot } from "../shared/parity-contract.js";
import { type RendererState } from "./state.js";

export interface RunnableRunStateResolution {
  runState: RunStateSnapshot;
  generatedPopulation: boolean;
}

export function resolveRunnableRunState(
  state: RendererState,
  createPreviewRunState: (
    runId: string,
    baseState: RunStateSnapshot,
  ) => RunStateSnapshot,
): RunnableRunStateResolution {
  if (state.runState.population.length > 0) {
    return {
      runState: {
        ...state.runState,
        mode: "evolution",
      },
      generatedPopulation: false,
    };
  }

  return {
    runState: createPreviewRunState(state.runState.runId, {
      ...state.runState,
      mode: "evolution",
    }),
    generatedPopulation: true,
  };
}

export function resolveEvolutionPreviewRunState(
  state: RendererState,
  createPreviewRunState: (
    runId: string,
    baseState: RunStateSnapshot,
  ) => RunStateSnapshot,
): RunStateSnapshot {
  if (state.lastEvaluatedRunState) {
    return state.lastEvaluatedRunState;
  }

  return resolveRunnableRunState(state, createPreviewRunState).runState;
}
