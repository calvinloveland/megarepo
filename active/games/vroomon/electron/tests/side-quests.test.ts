import { describe, expect, it } from "vitest";
import {
  SIDE_QUESTS,
  activeSideQuests,
  claimableQuests,
  findSideQuest,
  objectiveProgress,
  questProgress,
  sideQuestLog,
  type QuestRun,
  type QuestWorld,
} from "../src/renderer/world/side-quests.js";

const RUN: QuestRun = { generation: 0, populationSize: 0, bestScore: 0, released: 0 };

function world(overrides: Partial<QuestWorld> = {}): QuestWorld {
  return {
    badges: [],
    decor: [],
    vroomdex: [],
    flags: {},
    tally: {},
    currentMapId: "starter_town",
    ...overrides,
  };
}

describe("side quests", () => {
  it("ships jobs for the town and the road", () => {
    expect(SIDE_QUESTS.length).toBeGreaterThanOrEqual(4);
    for (const quest of SIDE_QUESTS) {
      expect(quest.title.length).toBeGreaterThan(0);
      expect(quest.offer.length).toBeGreaterThan(0);
      expect(quest.reward.thanks.length).toBeGreaterThan(0);
      expect(quest.acceptFlag.startsWith("quest-")).toBe(true);
    }
    expect(findSideQuest("wranglers-muster")).toBeDefined();
    expect(findSideQuest("nope")).toBeUndefined();
  });

  it("is not started until a giver offers it", () => {
    const muster = findSideQuest("wranglers-muster")!;
    const before = questProgress(muster, world(), RUN);
    expect(before.accepted).toBe(false);
    expect(before.done).toBe(false);
    // Progress still reads (you might already have the count) but a quest
    // nobody offered can't be finished.
    const withWins = questProgress(
      muster,
      world({ tally: { wildWins: 5 } }),
      RUN,
    );
    expect(withWins.accepted).toBe(false);
    expect(withWins.done).toBe(false);
  });

  it("counts each objective from the world it lives in", () => {
    expect(objectiveProgress({ kind: "catch-wild", count: 4, label: "" }, world({ vroomdex: ["a", "b"] }), RUN)).toBe(2);
    expect(objectiveProgress({ kind: "win-wild", count: 3, label: "" }, world({ tally: { wildWins: 2 } }), RUN)).toBe(2);
    expect(objectiveProgress({ kind: "generations", count: 5, label: "" }, world(), { ...RUN, generation: 7 })).toBe(7);
    expect(objectiveProgress({ kind: "decor", count: 3, label: "" }, world({ decor: ["x"] }), RUN)).toBe(1);
    expect(objectiveProgress({ kind: "visit", mapId: "hills_map", label: "" }, world({ tally: { "visited:hills_map": 1 } }), RUN)).toBe(1);
    expect(objectiveProgress({ kind: "visit", mapId: "ice_map", label: "" }, world(), RUN)).toBe(0);
    expect(objectiveProgress({ kind: "brands", count: 5, label: "" }, world({ badges: ["a", "b"] }), RUN)).toBe(2);
    expect(objectiveProgress({ kind: "champion-score", score: 900, label: "" }, world(), { ...RUN, bestScore: 1200 })).toBe(1200);
    expect(objectiveProgress({ kind: "release", count: 3, label: "" }, world(), { ...RUN, released: 4 })).toBe(4);
  });

  it("finishes when the count reaches the ask", () => {
    const samples = findSideQuest("oxide-samples")!;
    const accepted = world({ flags: { "quest-samples-accepted": true } });
    expect(questProgress(samples, accepted, RUN).done).toBe(false);

    const nearly = world({
      flags: { "quest-samples-accepted": true },
      vroomdex: ["a", "b", "c"],
    });
    expect(questProgress(samples, nearly, RUN).progressText).toBe("3/4 genomes in the Herd Book");

    const enough = world({
      flags: { "quest-samples-accepted": true },
      vroomdex: ["a", "b", "c", "d", "e"],
    });
    expect(questProgress(samples, enough, RUN).done).toBe(true);
  });

  it("lists taken jobs before unclaimed ones, and only nags about open ones", () => {
    const w = world({
      flags: { "quest-muster-accepted": true, "quest-count-accepted": true },
      tally: { wildWins: 3 },
    });
    const log = sideQuestLog(w, RUN);

    // Open jobs lead the log; finished-but-unpaid ones trail it, then the
    // jobs nobody has offered yet.
    expect(log[0]?.quest.id).toBe("long-road-count");
    expect(log[log.length - 1]?.done).toBe(true);
    expect(log[log.length - 1]?.quest.id).toBe("wranglers-muster");
    // ...and jobs nobody offered sit between the open ones and the finished.
    expect(log.some((entry) => !entry.accepted && !entry.done)).toBe(true);

    expect(activeSideQuests(w, RUN).map((entry) => entry.quest.id)).toEqual([
      "long-road-count",
    ]);
    expect(claimableQuests(w, RUN).map((entry) => entry.quest.id)).toEqual([
      "wranglers-muster",
    ]);
  });

  it("offers the orchard's jobs with real rewards", () => {
    const cutting = findSideQuest("orchard-cutting")!;
    expect(cutting.objective.kind).toBe("champion-score");
    expect(cutting.reward.dna).toBeTruthy();
    // A champion over the ask finishes it.
    const good = world({
      flags: { "quest-cutting-accepted": true },
    });
    expect(questProgress(cutting, good, { ...RUN, bestScore: 1200 }).done).toBe(true);
    expect(questProgress(cutting, good, { ...RUN, bestScore: 700 }).done).toBe(false);
    expect(questProgress(cutting, good, { ...RUN, bestScore: 700 }).progressText).toBe(
      "700/900 pts",
    );

    // The beekeeper pays in skeps, which are earned rather than sold.
    const clover = findSideQuest("orchard-clover")!;
    expect(clover.reward.decor).toBe("bee-skeps");
    expect(SIDE_QUESTS.map((quest) => quest.mapId)).toContain("marrow_orchard");
  });

  it("stops paying once a job is marked paid", () => {
    const w = world({
      flags: { "quest-muster-accepted": true },
      tally: { wildWins: 3, "paid:wranglers-muster": 1 },
    });
    expect(claimableQuests(w, RUN)).toHaveLength(0);
  });
});
