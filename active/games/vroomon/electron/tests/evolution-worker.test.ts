import { describe, expect, it } from "vitest";

import {
  type BatchRequest,
  type CancelRequest,
  type DoneMessage,
  type ErrorMessage,
  type ProgressMessage,
  type WorkerMessage,
  type WorkerRequest,
} from "../src/renderer/evolution.worker.js";

describe("evolution worker protocol", () => {
  it("exports the batch request shape used by the renderer", () => {
    const request: BatchRequest = {
      type: "run-batch",
      state: {
        version: 1,
        runId: "run-1",
        mode: "evolution",
        terrainName: "Flat",
        generation: 0,
        wallet: 0,
        config: {
          populationSize: 1,
          dnaLength: 1,
          retainRatio: 0.5,
          mutationRate: 0.1,
          raceDurationSeconds: 1,
        },
        population: [],
        genealogy: {},
      },
      count: 10,
    };

    expect(request.type).toBe("run-batch");
    expect(request.count).toBe(10);
    expect(request.state.terrainName).toBe("Flat");
  });

  it("exports a cancel request shape", () => {
    const request: CancelRequest = { type: "cancel" };
    expect(request.type).toBe("cancel");
  });

  it("discriminates the three message kinds", () => {
    const progress: ProgressMessage = {
      type: "progress",
      completed: 1,
      total: 10,
      state: {} as never,
      latestResult: {} as never,
      logEntry: {} as never,
    };
    const done: DoneMessage = {
      type: "done",
      completed: 10,
      total: 10,
      state: {} as never,
      logEntries: [],
      cancelled: false,
    };
    const error: ErrorMessage = { type: "error", message: "boom" };
    const messages: WorkerMessage[] = [progress, done, error];

    expect(messages.map((m) => m.type)).toEqual(["progress", "done", "error"]);
  });

  it("reuses the request union type for both messages", () => {
    const requests: WorkerRequest[] = [
      { type: "run-batch", state: {} as never, count: 1 },
      { type: "cancel" },
    ];
    expect(requests).toHaveLength(2);
  });
});
