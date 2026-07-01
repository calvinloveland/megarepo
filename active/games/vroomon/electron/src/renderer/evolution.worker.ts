import { runEvolutionGeneration } from "../core/population.js";
import { createGenerationLogEntry, type GenerationLogEntry } from "../core/persistence.js";
import type { RunStateSnapshot } from "../shared/parity-contract.js";
import type { GenerationResult } from "../core/population.js";

export interface BatchRequest {
  type: "run-batch";
  state: RunStateSnapshot;
  count: number;
}

export interface CancelRequest {
  type: "cancel";
}

export type WorkerRequest = BatchRequest | CancelRequest;

export interface ProgressMessage {
  type: "progress";
  completed: number;
  total: number;
  state: RunStateSnapshot;
  latestResult: GenerationResult;
  logEntry: GenerationLogEntry;
}

export interface DoneMessage {
  type: "done";
  completed: number;
  total: number;
  state: RunStateSnapshot;
  logEntries: GenerationLogEntry[];
  cancelled: boolean;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type WorkerMessage = ProgressMessage | DoneMessage | ErrorMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let cancelRequested = false;

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;

  if (data.type === "cancel") {
    cancelRequested = true;
    return;
  }

  if (data.type !== "run-batch") {
    return;
  }

  try {
    cancelRequested = false;
    let currentState: RunStateSnapshot = data.state;
    const logEntries: GenerationLogEntry[] = [];

    for (let index = 0; index < data.count; index += 1) {
      if (cancelRequested) {
        postDoneMessage(index, data.count, currentState, logEntries, true);
        return;
      }

      const result = runEvolutionGeneration(currentState);
      currentState = {
        ...currentState,
        generation: currentState.generation + 1,
        population: result.nextPopulation,
        genealogy: result.nextGenealogy,
        wallet:
          currentState.wallet +
          Math.floor(
            Math.max(0, ...result.evaluation.results.map((r) => r.score)) / 50,
          ),
      };
      const logEntry = createGenerationLogEntry(currentState, result);
      logEntries.push(logEntry);

      const progressMessage: ProgressMessage = {
        type: "progress",
        completed: index + 1,
        total: data.count,
        state: currentState,
        latestResult: result,
        logEntry,
      };
      ctx.postMessage(progressMessage);
    }

    postDoneMessage(data.count, data.count, currentState, logEntries, false);
  } catch (error) {
    const errorMessage: ErrorMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(errorMessage);
  }
});

function postDoneMessage(
  completed: number,
  total: number,
  state: RunStateSnapshot,
  logEntries: GenerationLogEntry[],
  cancelled: boolean,
): void {
  const doneMessage: DoneMessage = {
    type: "done",
    completed,
    total,
    state,
    logEntries,
    cancelled,
  };
  ctx.postMessage(doneMessage);
}

export {};
