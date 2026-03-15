import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGenerationLogEntry } from "../src/core/persistence.js";
import { runEvolutionGeneration } from "../src/core/population.js";
import {
  appendGenerationLogToDisk,
  loadGenerationLogFromDisk,
  loadRunStateFromDisk,
  saveRunStateToDisk,
} from "../src/main/file-store.js";
import { createEmptyRunState } from "../src/shared/parity-contract.js";

const directoriesToDelete: string[] = [];

afterEach(async () => {
  await Promise.all(
    directoriesToDelete.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("file store", () => {
  it("saves and loads a run state from disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vroomon-store-"));
    directoriesToDelete.push(directory);
    const state = createEmptyRunState("evolution", "Grassland", "run-1");

    await saveRunStateToDisk(directory, state);
    const loadedState = await loadRunStateFromDisk(directory);

    expect(loadedState).toEqual(state);
  });

  it("appends and reloads generation log entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vroomon-log-"));
    directoriesToDelete.push(directory);
    const baseState = createEmptyRunState("evolution", "Flat", "run-2");
    const generation = runEvolutionGeneration({
      ...baseState,
      population: [
        { id: "run-2-00001", dna: "A3x9K2m7P4zQ", parents: [], mutated: false, score: 0 },
        { id: "run-2-00002", dna: "zzYY1199ABcd", parents: [], mutated: false, score: 0 },
      ],
      genealogy: {
        "run-2-00001": [],
        "run-2-00002": [],
      },
    });

    await appendGenerationLogToDisk(
      directory,
      createGenerationLogEntry(baseState, generation),
    );

    const entries = await loadGenerationLogFromDisk(directory, "run-2");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      runId: "run-2",
      generation: 1,
      terrainName: "Flat",
    });
  });
});
