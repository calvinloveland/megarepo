import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAPS } from "../../src/renderer/world/maps.js";
import {
  commandFor,
  scriptForNpc,
  scriptForText,
  toEngineNode,
} from "../../src/renderer/world/dialogue-bridge.js";
import { DialogueSession, type Condition, type ScriptHost } from "../../src/engine/dialogue.js";

interface RecordingHost extends ScriptHost {
  flags: Record<string, boolean>;
  tallies: Record<string, number>;
  commands: Array<{ command: string; arg: string | undefined }>;
}

function recordingHost(): RecordingHost {
  const flags: Record<string, boolean> = {};
  const tallies: Record<string, number> = {};
  const commands: Array<{ command: string; arg: string | undefined }> = [];
  const host = {
    flags,
    tallies,
    commands,
    getFlag: (flag) => flags[flag] === true,
    setFlag: (flag, value) => {
      flags[flag] = value;
    },
    countItem: () => 0,
    coins: () => 0,
    tally: (key: string) => tallies[key] ?? 0,
    run: (command, arg) => {
      commands.push({ command, arg });
      return true;
    },
  };
  return host;
}

const labels = (session: DialogueSession): string[] => session.options().map((option) => option.label);

describe("the dialogue bridge", () => {
  it("builds a script for every person on every map", () => {
    // The engine validates a script when it is built: a link to a node nobody
    // wrote, or two people sharing an id, throws here instead of ending a
    // conversation silently in front of the player.
    let built = 0;
    for (const map of Object.values(MAPS)) {
      for (const npc of map.npcs) {
        if (!npc.dialogue) {
          continue;
        }
        const script = scriptForNpc(map.id, npc.id);
        expect(script, `${map.id}/${npc.id}`).not.toBeNull();
        expect(script!.start).toBe(npc.id);
        built += 1;
      }
    }
    expect(built).toBeGreaterThan(200);
    expect(scriptForNpc("starter_town", "nobody-by-that-name")).toBeNull();
    expect(scriptForNpc("no-such-map", "anyone")).toBeNull();
  });

  it("maps an authored onComplete onto the verb it means", () => {
    expect(commandFor({ onComplete: null })).toBeNull();
    expect(commandFor({ onComplete: "wild" })).toEqual({ command: "wild" });
    expect(commandFor({ onComplete: "gym" })).toEqual({ command: "gym" });
    expect(commandFor({ onComplete: "vroomdex" })).toEqual({ command: "vroomdex" });
    expect(commandFor({ onComplete: "grand-roundup" })).toEqual({ command: "grand-roundup" });
    expect(commandFor({ onComplete: "open-ranch" })).toEqual({ command: "open-ranch" });
    expect(commandFor({ onComplete: "starter-vroomon" })).toEqual({ command: "starter-vroomon" });
    expect(commandFor({ onComplete: "goto:ranch_yard:7:2" })).toEqual({
      command: "goto",
      arg: "ranch_yard:7:2",
    });
    expect(commandFor({ onComplete: "goto:ranch_yard:7:2:robby-yard-1" })).toEqual({
      command: "goto",
      arg: "ranch_yard:7:2:robby-yard-1",
    });
    expect(commandFor({ onComplete: "join-faction:skimmers" })).toEqual({
      command: "join-faction",
      arg: "skimmers",
    });
    // A rival's car is authored on the node and travels as the argument.
    expect(commandFor({ onComplete: "trainer", rivalDna: "A9gpwYaIPmdg" })).toEqual({
      command: "trainer",
      arg: "A9gpwYaIPmdg",
    });
    expect(commandFor({ onComplete: "trainer" })).toEqual({ command: "trainer" });
  });

  it("puts the flag before the verb, both on leave", () => {
    const node = toEngineNode("beat", {
      text: "An offer.",
      setFlag: "accepted",
      onComplete: "join-faction:runners",
      options: [{ label: "Take it", next: "next-beat" }],
    });
    expect(node.effects).toBeUndefined();
    expect(node.onLeave).toEqual([
      { kind: "set-flag", flag: "accepted" },
      { kind: "command", command: "join-faction", arg: "runners" },
    ]);
    expect(node.options).toEqual([{ label: "Take it", next: "next-beat" }]);

    // A plain beat is a plain beat: no effects at all, and nothing to run.
    const plain = toEngineNode("plain", { text: "Just a line." });
    expect(plain.onLeave).toBeUndefined();
    expect(plain.next).toBeUndefined();
  });

  it("records a flagged beat when it is left, not when it appears", () => {
    // The authored rule Vroomon has always had, now the engine's: the beat that
    // hands out the job records it on the way out, so a player who reads it and
    // closes the panel has not accepted anything.
    const host = recordingHost();
    const session = new DialogueSession(scriptForNpc("marrow_orchard", "keeper-maren")!, host);
    expect(session.current()?.id).toBe("keeper-maren");
    expect(host.flags["quest-cutting-accepted"]).toBeUndefined();

    const jobIndex = labels(session).findIndex((label) => label.includes("pay"));
    expect(jobIndex, labels(session).join(" | ")).toBeGreaterThanOrEqual(0);
    session.choose(jobIndex);
    expect(session.current()?.id).toBe("maren-cutting");
    expect(host.flags["quest-cutting-accepted"]).toBeUndefined();

    session.advance();
    expect(host.flags["quest-cutting-accepted"]).toBe(true);
    expect(session.isOpen()).toBe(false);
  });

  it("replaces a line for one conversation without touching the content", () => {
    // How a greeting is chosen by standing, and how the feud briefing stands in
    // for an arena's countdown.
    const overridden = scriptForNpc("marrow_orchard", "keeper-maren", {
      "keeper-maren": "Back again, is it?",
    })!;
    expect(overridden.nodes.get("keeper-maren")?.text).toBe("Back again, is it?");
    expect(overridden.nodes.get("maren-lines")?.text.length).toBeGreaterThan(20);

    // The cache is not polluted: the next conversation gets the authored line.
    const plain = scriptForNpc("marrow_orchard", "keeper-maren")!;
    expect(plain.nodes.get("keeper-maren")?.text).toContain("mind the clover");
  });

  it("says a one-line aside that ends when it is read", () => {
    const host = recordingHost();
    const session = new DialogueSession(scriptForText("A voice over the greeting."), host);
    expect(session.current()?.text).toBe("A voice over the greeting.");
    expect(session.options()).toEqual([]);
    session.advance();
    expect(session.isOpen()).toBe(false);
  });

  it("runs the authored verb through a session, at the moment the beat is left", () => {
    // The faction join, end to end: the player picks the option, the beat that
    // does the joining is shown, and the verb fires as they leave it.
    const host = recordingHost();
    const session = new DialogueSession(scriptForNpc("hills_map", "guru-updrafts")!, host);
    const joinIndex = labels(session).findIndex((label) => label.toLowerCase().includes("join"));
    expect(joinIndex, labels(session).join(" | ")).toBeGreaterThanOrEqual(0);
    expect(session.choose(joinIndex)).toBe(true);
    expect(host.commands, "the join fires on the beat that says it, not on the menu").toEqual([]);

    session.advance();
    expect(host.commands[0]).toMatchObject({ command: "join-faction", arg: "skimmers" });
  });
});

/** Every flag a condition reads, including inside all/any/not. */
function flagsRead(condition: Condition | undefined, out: string[] = []): string[] {
  if (!condition) {
    return out;
  }
  switch (condition.kind) {
    case "flag":
      out.push(condition.flag);
      break;
    case "all":
    case "any":
      for (const inner of condition.of) {
        flagsRead(inner, out);
      }
      break;
    case "not":
      flagsRead(condition.of, out);
      break;
    default:
      break;
  }
  return out;
}

describe("authored options are gated, and the gate means something", () => {
  it("hides the job offer until it is taken, then answers about it", () => {
    // The Brambles' warden is the world's first conditioned menu: the offer is
    // there until the job is taken and the question about it is there after.
    const host = recordingHost();
    const before = new DialogueSession(scriptForNpc("bramble_maze", "bramble-warden-kess")!, host);
    const offerIndex = labels(before).findIndex((label) => label.includes("keep the track open"));
    expect(offerIndex, labels(before).join(" | ")).toBeGreaterThanOrEqual(0);
    expect(labels(before).some((label) => label.includes("Which gullies"))).toBe(false);

    // Taking it shows the beat that hands the job out...
    expect(before.choose(offerIndex)).toBe(true);
    expect(before.current()?.id).toBe("bramble-kess-job");
    expect(host.flags["quest-bramble-accepted"]).toBeUndefined();
    // ...and accepting is leaving that beat.
    before.advance();
    expect(host.flags["quest-bramble-accepted"]).toBe(true);

    // Which flips the menu: no offer, and the question it raises.
    const after = new DialogueSession(scriptForNpc("bramble_maze", "bramble-warden-kess")!, host);
    expect(labels(after).some((label) => label.includes("keep the track open"))).toBe(false);
    const detailIndex = labels(after).findIndex((label) => label.includes("Which gullies"));
    expect(detailIndex, labels(after).join(" | ")).toBeGreaterThanOrEqual(0);
    expect(after.choose(detailIndex)).toBe(true);
    expect(after.current()?.id).toBe("bramble-kess-detail");
  });

  it("carries news between two people: a gate whose flag is set elsewhere", () => {
    // Bram asked about Tam. The answer only exists once Tam has been walked
    // out of the maze — and that flag is set in the middle of the maze, by
    // somebody else's conversation. This is the shape a condition is really
    // for: what one person knows because of what another one said.
    const host = recordingHost();
    const before = new DialogueSession(scriptForNpc("hedge_maze", "hedge-keeper-bram")!, host);
    expect(labels(before).some((label) => label.includes("back at the gate"))).toBe(false);

    // Walking Tam out sets the flag on the way through the beat.
    const tam = new DialogueSession(scriptForNpc("hedge_maze", "maze-picker-tam")!, host);
    const walkIndex = labels(tam).findIndex((label) => label.includes("way out"));
    expect(walkIndex, labels(tam).join(" | ")).toBeGreaterThanOrEqual(0);
    tam.choose(walkIndex);
    expect(tam.current()?.id).toBe("tam-walk");
    expect(host.flags["tam-walked-home"]).toBeUndefined();
    tam.advance();
    expect(host.flags["tam-walked-home"]).toBe(true);
    expect(host.commands.map((entry) => entry.command)).toContain("goto");

    // ...and the news is on Bram's menu afterwards.
    const after = new DialogueSession(scriptForNpc("hedge_maze", "hedge-keeper-bram")!, host);
    const newsIndex = labels(after).findIndex((label) => label.includes("back at the gate"));
    expect(newsIndex, labels(after).join(" | ")).toBeGreaterThanOrEqual(0);
    expect(after.choose(newsIndex)).toBe(true);
    expect(after.current()?.id).toBe("maze-bram-tam-home");
  });

  it("opens on a different greeting when the first one no longer fits", () => {
    // Tam's opening line is written for a picker who has not been walked out
    // yet. Met again afterwards, the old line is not wrong so much as a
    // different conversation — and offering to walk them out again warped the
    // player to the orchard a second time.
    const host = recordingHost();
    const before = new DialogueSession(scriptForNpc("hedge_maze", "maze-picker-tam")!, host);
    expect(before.current()?.text).toContain("Third left");
    expect(labels(before)).toContain("I know the way out.");

    host.flags["tam-walked-home"] = true;
    const after = new DialogueSession(scriptForNpc("hedge_maze", "maze-picker-tam")!, host);
    expect(after.current()?.id).toBe("tam-again");
    expect(after.current()?.text).toContain("You came back in");
    expect(labels(after), "the rescue option should be gone with the rescue").not.toContain(
      "I know the way out.",
    );
  });

  it("gates an option on how much of the job is done, not just on the flag", () => {
    // A counter says *how many*: Kess can tell you the gully knows you before
    // the job is paid, because the ground has been counting the races.
    const host = recordingHost();
    host.flags["quest-bramble-accepted"] = true;
    host.tallies["wildWins:bramble_maze"] = 1;
    const early = new DialogueSession(scriptForNpc("bramble_maze", "bramble-warden-kess")!, host);
    expect(labels(early).some((label) => label.includes("knows me now"))).toBe(false);

    host.tallies["wildWins:bramble_maze"] = 2;
    const later = new DialogueSession(scriptForNpc("bramble_maze", "bramble-warden-kess")!, host);
    const index = labels(later).findIndex((label) => label.includes("knows me now"));
    expect(index, labels(later).join(" | ")).toBeGreaterThanOrEqual(0);
    expect(later.choose(index)).toBe(true);
    expect(later.current()?.id).toBe("bramble-kess-known");
  });

  it("never gates an option on a flag nobody sets", () => {
    // A `when` on a flag nothing writes is an option that can never appear —
    // written, placed, and unreachable. This is the same trap the quest
    // contracts catch for accept flags, applied to menu conditions.
    const written = new Set<string>();
    for (const map of Object.values(MAPS)) {
      for (const npc of map.npcs) {
        if (npc.dialogue?.setFlag) {
          written.add(npc.dialogue.setFlag);
        }
      }
    }
    for (const file of [
      "src/renderer/renderer.ts",
      "src/renderer/world/overworld-controller.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/setFlag\(\s*"([^"]+)"/g)) {
        written.add(match[1]!);
      }
    }

    const gated: string[] = [];
    const orphans: string[] = [];
    for (const map of Object.values(MAPS)) {
      for (const npc of map.npcs) {
        for (const option of npc.dialogue?.options ?? []) {
          const flags = flagsRead(option.when);
          if (flags.length > 0) {
            gated.push(`${map.id}/${npc.id}`);
          }
          for (const flag of flags) {
            if (!written.has(flag)) {
              orphans.push(`${map.id}/${npc.id} "${option.label}" waits on ${flag}`);
            }
          }
        }
      }
    }
    expect(orphans, `options gated on flags nothing sets: ${orphans.join("; ")}`).toEqual([]);
    // And it is a pattern by now, not one warden's trick: at least two
    // people in the world gate a menu option on the state of the world.
    expect(new Set(gated).size, "fewer than two people gate an option").toBeGreaterThan(1);
  });
});
