import { describe, expect, it } from "vitest";
import {
  SIDE_QUESTS,
  activeSideQuests,
  claimableQuests,
  findSideQuest,
  objectiveProgress,
  questBeats,
  questProgress,
  isUnlocked,
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
      "700/900 pts on the flat",
    );

    // The beekeeper pays in skeps, which are earned rather than sold.
    const clover = findSideQuest("orchard-clover")!;
    expect(clover.reward.decor).toBe("bee-skeps");
    expect(SIDE_QUESTS.map((quest) => quest.mapId)).toContain("marrow_orchard");
  });

  it("holds follow-up jobs until the one before is paid", () => {
    const board = findSideQuest("town-board")!;
    expect(board.requires).toBe("wranglers-muster");

    // Locked: not on the board, and not completable even with the count.
    const locked = world({ tally: { wildWins: 20 } });
    expect(isUnlocked(board, locked)).toBe(false);
    expect(sideQuestLog(locked, RUN).some((entry) => entry.quest.id === "town-board")).toBe(false);
    expect(questProgress(board, locked, RUN).done).toBe(false);

    // Paid prerequisite: it appears, and the count finishes it.
    const open = world({ tally: { "paid:wranglers-muster": 1, wildWins: 8 } });
    expect(isUnlocked(board, open)).toBe(true);
    expect(sideQuestLog(open, RUN).some((entry) => entry.quest.id === "town-board")).toBe(true);
    expect(questProgress(board, { ...open, flags: { "quest-board-accepted": true } }, RUN).done).toBe(true);
  });

  it("counts the wild per biome, so each ground has its own job", () => {
    const wager = findSideQuest("salt-road-wager")!;
    expect(wager.objective.kind).toBe("win-wild-on");
    if (wager.objective.kind !== "win-wild-on") {
      throw new Error("expected a per-biome objective");
    }
    const perBiome = world({
      flags: { "quest-salt-wager-accepted": true },
      tally: { "paid:wranglers-muster": 1, "wildWins:route_2": 1, wildWins: 9 },
    });
    // Nine wins on the road do not count toward the Stretch.
    expect(questProgress(wager, perBiome, RUN).have).toBe(1);
    expect(questProgress(wager, perBiome, RUN).done).toBe(false);
    const two = world({
      flags: { "quest-salt-wager-accepted": true },
      tally: { "paid:wranglers-muster": 1, "wildWins:route_2": 2 },
    });
    expect(questProgress(wager, two, RUN).done).toBe(true);
  });

  it("ships a job for every far biome", () => {
    const biomes = ["route_2", "hills_map", "rocky_map", "ice_map"];
    for (const mapId of biomes) {
      expect(
        SIDE_QUESTS.some((quest) => quest.objective.kind === "win-wild-on" && quest.objective.mapId === mapId),
        `no job for ${mapId}`,
      ).toBe(true);
    }
  });

  it("counts grounds in the book, not catches", () => {
    // Four Grounds is satisfied by specimens from four biomes, however many
    // you have from each.
    const four = findSideQuest("four-grounds")!;
    expect(four.objective.kind).toBe("dex-biomes");
    const accepted = { flags: { "quest-book-accepted": true } };
    const notes = (maps: string[]) =>
      Object.fromEntries(
        maps.map((mapId, index) => [
          `dna${index}`,
          { mapId, score: 100, caughtAt: "2026-09-15T12:00:00.000Z", origin: "caught" as const },
        ]),
      );

    expect(questProgress(four, world({ ...accepted, specimenMeta: notes(["ranch_yard", "ranch_yard", "ranch_yard"]) }), RUN).have).toBe(1);
    expect(questProgress(four, world({ ...accepted, specimenMeta: notes(["ranch_yard", "route_2", "hills_map"]) }), RUN).done).toBe(false);
    expect(
      questProgress(
        four,
        world({ ...accepted, specimenMeta: notes(["ranch_yard", "route_2", "hills_map", "ice_map"]) }),
        RUN,
      ).done,
    ).toBe(true);
  });

  it("measures a champion on a named terrain from the records", () => {
    const lane = findSideQuest("lane-proof")!;
    expect(lane.objective.kind).toBe("champion-on");
    // It sits behind the orchard's cutting, so pay that first.
    const accepted = world({
      flags: { "quest-lane-accepted": true },
      tally: { "paid:orchard-cutting": 1 },
    });
    expect(questProgress(lane, accepted, { ...RUN, bestByTerrain: { Sand: 900 } }).done).toBe(false);
    expect(
      questProgress(lane, accepted, { ...RUN, bestByTerrain: { Sand: 1150 } }).progressText,
    ).toBe("1150/1100 pts on the Stretch");
    expect(questProgress(lane, accepted, { ...RUN, bestByTerrain: { Sand: 1150 } }).done).toBe(true);
  });

  it("pays in things a rancher can actually spend", () => {
    // A reward that is neither credits, feed, a genome, nor an earnable
    // cosmetic is a thank-you note.
    for (const quest of SIDE_QUESTS) {
      const { reward } = quest;
      const spendable =
        (reward.wallet ?? 0) > 0 ||
        (reward.feed ?? 0) > 0 ||
        Boolean(reward.dna) ||
        Boolean(reward.decor);
      expect(spendable, `${quest.id} pays nothing`).toBe(true);
      if (reward.wallet !== undefined) {
        expect(reward.wallet).toBeGreaterThan(0);
      }
      if (reward.feed !== undefined) {
        expect(reward.feed).toBeGreaterThan(0);
      }
    }
  });

  it("stops paying once a job is marked paid", () => {
    const w = world({
      flags: { "quest-muster-accepted": true },
      tally: { wildWins: 3, "paid:wranglers-muster": 1 },
    });
    expect(claimableQuests(w, RUN)).toHaveLength(0);
  });
});

describe("a giver says their own lines", () => {
  const muster = findSideQuest("wranglers-muster")!;

  it("offers the job in their own words before you take it", () => {
    const beats = questBeats(world(), RUN, "wrangler-jess", "Wrangler Jess");
    expect(beats.offer?.id).toBe("wranglers-muster");
    expect(beats.offer?.text).toBe(muster.offer);
    expect(beats.thanks).toBeNull();
  });

  it("nags in proportion once you have taken it", () => {
    const beats = questBeats(
      world({ flags: { "quest-muster-accepted": true } }),
      RUN,
      "wrangler-jess",
      "Wrangler Jess",
    );
    expect(beats.pending?.id).toBe("wranglers-muster");
    expect(beats.pending?.text).toContain("wrangler's muster");
    // Her other jobs may still be on offer, but never the one you have taken.
    expect(beats.offer?.id).not.toBe("wranglers-muster");
  });

  it("says thank you when the work is done and unpaid", () => {
    const beats = questBeats(
      world({
        flags: { "quest-muster-accepted": true },
        tally: { wildWins: 3 },
      }),
      RUN,
      "wrangler-jess",
      "Wrangler Jess",
    );
    expect(beats.thanks?.id).toBe("wranglers-muster");
    expect(beats.thanks?.text).toBe(muster.reward.thanks);
    // The reward is paid the instant the work is done, so the words wait for
    // the next meeting - and having said them, they are done.
    const paid = questBeats(
      world({
        flags: { "quest-muster-accepted": true },
        tally: { wildWins: 3, "paid:wranglers-muster": 1 },
      }),
      RUN,
      "wrangler-jess",
      "Wrangler Jess",
    );
    expect(paid.thanks?.id).toBe("wranglers-muster");
    const said = questBeats(
      world({
        flags: { "quest-muster-accepted": true },
        tally: {
          wildWins: 3,
          "paid:wranglers-muster": 1,
          "spoken:wranglers-muster": 1,
        },
      }),
      RUN,
      "wrangler-jess",
      "Wrangler Jess",
    );
    expect(said.thanks).toBeNull();
    expect(said.offer?.id).not.toBe("wranglers-muster");
  });

  it("leaves people who give you nothing out of it", () => {
    const beats = questBeats(world(), RUN, "meadow-elder", "Meadow Elder");
    expect(beats.offer).toBeNull();
    expect(beats.pending).toBeNull();
    expect(beats.thanks).toBeNull();
  });

  it("pays before it chases, and chases before it offers", () => {
    // A giver with a finished job, an open one and a new one waiting: the
    // money comes first, then the reminder, then the next job.
    const beats = questBeats(
      world({
        flags: { "quest-muster-accepted": true, "quest-freight-accepted": true },
        tally: { wildWins: 3 },
      }),
      RUN,
      "wrangler-jess",
      "Wrangler Jess",
    );
    expect(beats.thanks?.id).toBe("wranglers-muster");
  });
});
