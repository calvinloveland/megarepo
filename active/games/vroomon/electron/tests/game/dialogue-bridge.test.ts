import { describe, expect, it } from "vitest";

import { MAPS } from "../../src/renderer/world/maps.js";
import {
  commandFor,
  scriptForNpc,
  scriptForText,
  toEngineNode,
} from "../../src/renderer/world/dialogue-bridge.js";
import { DialogueSession, type ScriptHost } from "../../src/engine/dialogue.js";

interface RecordingHost extends ScriptHost {
  flags: Record<string, boolean>;
  commands: Array<{ command: string; arg: string | undefined }>;
}

function recordingHost(): RecordingHost {
  const flags: Record<string, boolean> = {};
  const commands: Array<{ command: string; arg: string | undefined }> = [];
  return {
    flags,
    commands,
    getFlag: (flag) => flags[flag] === true,
    setFlag: (flag, value) => {
      flags[flag] = value;
    },
    countItem: () => 0,
    coins: () => 0,
    run: (command, arg) => {
      commands.push({ command, arg });
      return true;
    },
  };
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
