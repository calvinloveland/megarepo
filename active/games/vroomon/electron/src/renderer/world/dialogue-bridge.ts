// Vroomon's dialogue, in the engine's terms.
//
// The authored shape is a map of NPCs where a node's links are the *ids of the
// other NPCs on the same map*: `next: "maren-lines"` means "show the person
// called maren-lines", who is a story stub parked at 0,0. The engine's shape is
// a script with explicit node ids. They are the same graph; this module is the
// translation, and it is the only place that knows both.
//
// The engine validates on the way in, which is how a link to a node nobody
// wrote stops being a conversation that quietly ends and becomes a failure.
// `tests/game/dialogue-bridge.test.ts` builds a script for every map in the
// world, so that check runs over all the shipped content.
//
// Timing: Vroomon records a node's `setFlag` when the player leaves the beat,
// and runs its `onComplete` at the same moment. Both are `onLeave` effects
// here, in that order — the flag first, then the verb.

import {
  createDialogueScript,
  type DialogueScript,
  type DialogueNode as EngineDialogueNode,
  type Effect,
} from "../../engine/dialogue.js";
import { getMap } from "./maps.js";
import type { DialogueNode } from "./types.js";

const nodeCache = new Map<string, EngineDialogueNode[]>();

/** Every authored node on a map, as engine nodes, built once per map. */
function nodesFor(mapId: string): EngineDialogueNode[] | null {
  const cached = nodeCache.get(mapId);
  if (cached) {
    return cached;
  }
  const map = getMap(mapId);
  if (!map) {
    return null;
  }
  const nodes = map.npcs
    .filter((npc) => npc.dialogue !== null && npc.dialogue !== undefined)
    .map((npc) => toEngineNode(npc.id, npc.dialogue!));
  nodeCache.set(mapId, nodes);
  return nodes;
}

/**
 * A conversation with one person on one map. `textOverrides` replaces a node's
 * line for this conversation only — how a greeting is chosen by standing, and
 * how the feud briefing replaces an arena's "three, two, one".
 */
export function scriptForNpc(
  mapId: string,
  npcId: string,
  textOverrides?: Record<string, string>,
): DialogueScript | null {
  const nodes = nodesFor(mapId);
  if (!nodes || !nodes.some((node) => node.id === npcId)) {
    return null;
  }
  return createDialogueScript({
    id: `${mapId}:${npcId}`,
    start: npcId,
    nodes: textOverrides
      ? nodes.map((node) => {
          const override = textOverrides[node.id];
          return override === undefined ? node : { ...node, text: override };
        })
      : nodes,
  });
}

/** A one-line aside: a voice over a greeting, a narrator's note, a praise beat. */
export function scriptForText(text: string, id = "aside"): DialogueScript {
  return createDialogueScript({ id, start: id, nodes: [{ id, text }] });
}

/** The verb an authored `onComplete` means, with the argument it needs. */
export function commandFor(
  node: Pick<DialogueNode, "onComplete" | "rivalDna">,
): { command: string; arg?: string } | null {
  const onComplete = node.onComplete;
  if (!onComplete) {
    return null;
  }
  if (onComplete.startsWith("goto:")) {
    return { command: "goto", arg: onComplete.slice("goto:".length) };
  }
  if (onComplete.startsWith("join-faction:")) {
    return { command: "join-faction", arg: onComplete.slice("join-faction:".length) };
  }
  // A rival's car travels as the command's argument: the authored node owns it,
  // and the engine neither knows nor needs to know what a rival is.
  if (onComplete === "trainer") {
    return { command: "trainer", ...(node.rivalDna === undefined ? {} : { arg: node.rivalDna }) };
  }
  return { command: onComplete };
}

export function toEngineNode(id: string, node: DialogueNode): EngineDialogueNode {
  const onLeave: Effect[] = [];
  if (node.setFlag) {
    onLeave.push({ kind: "set-flag", flag: node.setFlag });
  }
  const command = commandFor(node);
  if (command) {
    onLeave.push({
      kind: "command",
      command: command.command,
      ...(command.arg === undefined ? {} : { arg: command.arg }),
    });
  }
  return {
    id,
    text: node.text,
    ...(node.next === undefined ? {} : { next: node.next }),
    ...(node.options ? { options: node.options.map((option) => ({ label: option.label, next: option.next })) } : {}),
    ...(onLeave.length > 0 ? { onLeave } : {}),
  };
}

/** Drop the cache. A test that edits maps in place needs this; the game does not. */
export function forgetDialogueScripts(): void {
  nodeCache.clear();
}
