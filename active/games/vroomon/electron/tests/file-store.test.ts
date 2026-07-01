import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGenerationLogEntry } from "../src/core/persistence.js";
import { runEvolutionGeneration } from "../src/core/population.js";
import {
  appendGenerationLogToDisk,
  loadGenerationLogFromDisk,
  loadHallOfFameFromDisk,
  loadRunStateFromDisk,
  loadWorldStateFromDisk,
  saveHallOfFameToDisk,
  saveRunStateToDisk,
  saveWorldStateToDisk,
} from "../src/main/file-store.js";
import { createEmptyRunState, type HallOfFame } from "../src/shared/parity-contract.js";
import { type PersistedWorldState } from "../src/renderer/world/types.js";

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

  it("returns an empty hall of fame when none has been saved", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vroomon-hall-empty-"));
    directoriesToDelete.push(directory);

    const hall = await loadHallOfFameFromDisk(directory);

    expect(hall.version).toBe(1);
    expect(hall.entries).toEqual([]);
  });

  it("saves and loads a hall of fame", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vroomon-hall-"));
    directoriesToDelete.push(directory);

    const hall: HallOfFame = {
      version: 1,
      entries: [
        {
          id: "hall-1",
          runId: "run-1",
          dna: "A3x9K2m7P4zQ",
          name: "Champion",
          score: 250,
          terrainName: "Flat",
          generation: 5,
          savedAt: "2024-01-01T00:00:00.000Z",
          notes: "",
        },
      ],
    };

    const targetPath = await saveHallOfFameToDisk(directory, hall);
    expect(targetPath).toContain("hall-of-fame.json");

    const loaded = await loadHallOfFameFromDisk(directory);
    expect(loaded).toEqual(hall);
  });

  it("returns the default world when no save exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vroomon-world-empty-"));
    directoriesToDelete.push(directory);

    const world = await loadWorldStateFromDisk(directory);

    expect(world.version).toBe(1);
    expect(world.currentMapId).toBe("starter_town");
    expect(world.playerX).toBe(7);
    expect(world.playerY).toBe(7);
    expect(world.badges).toEqual([]);
    expect(world.vroomdex).toEqual([]);
  });

  it("saves and loads the overworld state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vroomon-world-"));
    directoriesToDelete.push(directory);

    const world: PersistedWorldState = {
      version: 1,
      currentMapId: "gym_1",
      playerX: 6,
      playerY: 4,
      playerFacing: "up",
      badges: ["Grass Badge"],
      vroomdex: ["A3x9K2m7P4zQ", "zzYY1199ABcd"],
      flags: { defeated_flint: true },
      lastSavedAt: "2024-06-01T12:00:00.000Z",
    };

    const targetPath = await saveWorldStateToDisk(directory, world);
    expect(targetPath).toContain("world-state.json");

    const loaded = await loadWorldStateFromDisk(directory);
    expect(loaded).toEqual(world);
  });

  it("falls back to defaults when the world file is corrupted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vroomon-world-bad-"));
    directoriesToDelete.push(directory);

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(directory, "vroomon"), { recursive: true });
    await writeFile(
      join(directory, "vroomon", "world-state.json"),
      "not json at all",
      "utf8",
    );

    const world = await loadWorldStateFromDisk(directory);
    expect(world.currentMapId).toBe("starter_town");
    expect(world.badges).toEqual([]);
  });
});
