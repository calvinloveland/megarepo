import { getMap, isTilePassable } from "./maps.js";
import {
  attemptMove,
  findAdjacentNpc,
  npcOnTile,
  isAtEdgeTransition,
  isOnWildEncounterTile,
  startMoveAnimation,
} from "./overworld-renderer.js";
import {
  awardBadge,
  endDialogue,
  joinFaction,
  recordEncounterDna,
  setMovementTarget,
  setPlayerFacing,
  startDialogue,
  syncDialogue,
  transitionToMap,
} from "./world-state.js";
import { DialogueSession, type ScriptHost } from "../../engine/dialogue.js";
import { commandFor, scriptForNpc, scriptForText } from "./dialogue-bridge.js";
import { findFaction, type Faction } from "./factions.js";
import { greetingFor, standingFor, type Standing } from "./routines.js";
import { BADGE_BY_MAP } from "../circuit.js";
import {
  type DialogueNode,
  type Direction,
  type NpcDefinition,
  type WorldState,
} from "./types.js";

export interface OverworldInputs {
  state: WorldState;
  interact: () => WorldState;
  move: (direction: Direction) => WorldState;
  advanceDialogue: () => WorldState;
  /** Pick the index-th visible option; `briefInstead` replaces the line of the
   * node it leads to (the feud briefing swaps an arena's countdown). */
  chooseDialogue: (index: number, briefInstead?: { nodeId: string; text: string }) => WorldState;
  /** Say one line as an aside, replacing whatever was on screen. */
  speakLine: (text: string) => WorldState;
  /** Start a conversation with somebody by id (a beat the game owes the player). */
  speakNpc: (npcId: string, textOverrides?: Record<string, string>) => WorldState;
  /** The authored node behind the beat on screen, for a game that wants to
   * know what it is looking at. */
  currentDialogueNode: () => DialogueNode | null;
  setFlag: (flag: string, value: boolean) => WorldState;
  _setState: (next: WorldState) => void;
  _awardBadge: (badge: string) => WorldState;
}

export function createOverworldInputs(
  initial: WorldState,
  dependencies: {
    onEncounterStart: (
      kind: "wild" | "trainer" | "gym",
      dna: string,
      trainerName: string | null,
    ) => void;
    onVroomdexTick: (dna: string) => void;
    /** Robby lends a starter vroomon so the first catch can be a race. */
    onStarterVroomon?: () => void;
    /**
     * The wild vroomon that lives on this ground. The renderer owns it
     * because the pack evolves by racing, which needs the simulation; the
     * controller only asks who is out there.
     */
    nextWildDna?: (mapId: string) => string;
    /** A clock, so routines can be tested against a fixed day. */
    now?: () => number;
    /** How well the world knows this rancher (the renderer owns the Hall). */
    standing?: () => Standing;
    onBadgeAwarded: (badge: string) => void;
    onFactionJoined?: (faction: Faction | null) => void;
    onMapTransition?: () => void;
    onGrandRoundup?: () => void;
    onOpenRanch?: () => void;
  },
): OverworldInputs {
  let state = initial;

  function commit(next: WorldState): WorldState {
    state = next;
    return state;
  }

  /** The line to open with: what happened last race, then how well they know you. */
  function openingLine(npc: { id: string; name: string; greetings?: NpcDefinition["greetings"] }): string | null {
    const standing: Standing =
      dependencies.standing?.() ??
      standingFor({
        badges: state.badges,
        vroomdex: state.vroomdex,
        flags: state.flags,
        hallOfFameEntries: 0,
      });
    const raced = state.tally?.[`lastrace:${npc.name}`];
    const lastRace = raced === 1 ? "win" : raced === 0 ? "loss" : null;
    return greetingFor(npc, standing, lastRace);
  }

  function interact(): WorldState {
    if (state.dialogue) {
      return advanceDialogueInput();
    }

    if (state.isMoving) {
      return state;
    }

    const map = getMap(state.currentMapId);
    if (!map) {
      return state;
    }

    const npc = findAdjacentNpc(state, dependencies.now?.() ?? Date.now());
    if (npc && npc.dialogue) {
      // People remember: a rival opens with the last race, everyone else with
      // how well they know you. The greeting is a line override on the opening
      // beat, so the menu it belongs to is untouched.
      const greeting = openingLine(npc);
      return speakNpc(npc.id, greeting ? { [npc.id]: greeting } : undefined);
    }

    return state;
  }

  /** The game's side of a conversation: flags, and the verbs a beat can fire. */
  const host: ScriptHost = {
    getFlag: (flag) => state.flags[flag] === true,
    setFlag: (flag, value) => {
      commit({ ...state, flags: { ...state.flags, [flag]: value } });
    },
    // Vroomon's world has no bag and no purse of its own: credits live in the
    // run state, which the world cannot see. Nothing authored asks for them
    // yet, and a condition that did would simply read zero.
    countItem: () => 0,
    coins: () => 0,
    run: (command, arg) => runDialogueCommand(command, arg),
  };

  /**
   * The verbs an authored `onComplete` becomes. Each ends the conversation
   * first: the beat has been read, and what comes next is a race card, a warp
   * or a badge rather than another line.
   */
  function runDialogueCommand(command: string, arg: string | undefined): boolean {
    const speaker = state.activeNpc
      ? getMap(state.currentMapId)?.npcs.find((npc) => npc.id === state.activeNpc) ?? null
      : null;
    switch (command) {
      case "wild": {
        const wildDna =
          dependencies.nextWildDna?.(state.currentMapId) ??
          `wild${Math.random().toString(36).slice(2, 12)}`;
        commit(endDialogue(state));
        dependencies.onEncounterStart("wild", wildDna, null);
        return true;
      }
      case "trainer":
      case "gym": {
        // The car is authored on the node and arrives as the argument; the old
        // derived string was a lottery, and one rival drew a car that could not
        // move at all.
        const trainerDna = arg ?? `trainer-${speaker?.id ?? "rival"}`;
        const trainerName = speaker?.name ?? "Rival";
        commit(endDialogue(state));
        dependencies.onEncounterStart(command, trainerDna, trainerName);
        return true;
      }
      case "vroomdex": {
        const dna = "prof" + Math.random().toString(36).slice(2, 10);
        const ended = endDialogue(state);
        commit({ ...ended, vroomdex: recordEncounterDna(ended, dna).vroomdex });
        dependencies.onVroomdexTick(dna);
        return true;
      }
      case "open-ranch":
        commit(endDialogue(state));
        dependencies.onOpenRanch?.();
        return true;
      case "grand-roundup":
        commit(endDialogue(state));
        dependencies.onGrandRoundup?.();
        return true;
      case "starter-vroomon":
        // Robby lends a starter before the lesson, so the first catch can be a
        // race, and puts you on the hunt: with the toggle off the lesson's tall
        // grass would never shake.
        commit({ ...endDialogue(state), hunting: true });
        dependencies.onStarterVroomon?.();
        return true;
      case "goto": {
        const [mapId, rawX, rawY, nodeId] = (arg ?? "").split(":");
        const target = getMap(mapId ?? "");
        const x = Number(rawX);
        const y = Number(rawY);
        if (!target || !Number.isFinite(x) || !Number.isFinite(y)) {
          return false;
        }
        // The story picks up on the far side: the beat that walked you out of
        // the house hands off to the one that greets you in the yard.
        const moved = transitionToMap(endDialogue(state), mapId!, x, y, "down");
        commit(moved);
        dependencies.onMapTransition?.();
        if (nodeId) {
          const script = scriptForNpc(moved.currentMapId, nodeId);
          if (script) {
            commit(startDialogue(moved, nodeId, new DialogueSession(script, host)));
          }
        }
        return true;
      }
      case "join-faction": {
        const factionId = arg ?? "";
        const faction = findFaction(factionId);
        commit(joinFaction(endDialogue(state), faction?.biomeId ?? "grassland", factionId));
        dependencies.onFactionJoined?.(faction);
        return true;
      }
      default:
        return false;
    }
  }

  function advanceDialogueInput(): WorldState {
    const session = state.dialogue;
    if (!session || session.options().length > 0) {
      return state;
    }
    session.advance();
    return commit(syncDialogue(state));
  }

  function chooseDialogueInput(
    index: number,
    briefInstead?: { nodeId: string; text: string },
  ): WorldState {
    const session = state.dialogue;
    if (!session) {
      return state;
    }
    if (briefInstead) {
      session.replaceText(briefInstead.nodeId, briefInstead.text);
    }
    session.choose(index);
    return commit(syncDialogue(state));
  }

  /** Say one line as an aside, replacing whatever was on screen. */
  function speakLine(text: string): WorldState {
    return commit(
      startDialogue(state, state.activeNpc ?? "narrator", new DialogueSession(scriptForText(text), host)),
    );
  }

  /** Start a conversation with somebody by id — a beat the game owes the player. */
  function speakNpc(npcId: string, textOverrides?: Record<string, string>): WorldState {
    const script = scriptForNpc(state.currentMapId, npcId, textOverrides);
    if (!script) {
      return state;
    }
    return commit(startDialogue(state, npcId, new DialogueSession(script, host)));
  }

  /** The authored node behind the beat on screen, for the game's own checks. */
  function currentDialogueNode(): DialogueNode | null {
    const session = state.dialogue;
    if (!session) {
      return null;
    }
    const currentNode = session.current();
    if (!currentNode) {
      return null;
    }
    const authored = getMap(state.currentMapId)?.npcs.find((npc) => npc.id === currentNode.id);
    return authored?.dialogue ?? null;
  }

  function move(direction: Direction): WorldState {
    if (state.isMoving || state.dialogue !== null) {
      return state;
    }

    const map = getMap(state.currentMapId);
    if (!map) {
      return state;
    }

    const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    const targetX = state.playerX + dx;
    const targetY = state.playerY + dy;

    if (targetX < 0 || targetX >= map.width || targetY < 0 || targetY >= map.height) {
      return commit(setPlayerFacing(state, direction));
    }

    const targetTile = map.tiles[targetY]?.[targetX] ?? "grass";
    // Whoever is standing there NOW, which a routine can move.
    const hasNpc = npcOnTile(map, targetX, targetY, dependencies.now?.() ?? Date.now()) !== null;

    if (!isTilePassable(targetTile) || hasNpc) {
      return commit(setPlayerFacing(state, direction));
    }

    const moveResult = attemptMove(state, direction, dependencies.now?.() ?? Date.now());
    commit(moveResult.state);
    startMoveAnimation();

    queueMicrotask(() => {
      const finalState = state;
      if (!finalState.isMoving) {
        return;
      }
      const transition = isAtEdgeTransition(finalState);
      if (transition) {
        commit(transitionToMap(finalState, transition.mapId, transition.x, transition.y, transition.facing));
        // The transition commits in this microtask, AFTER the renderer's
        // own renderOverworldUi ran against the old map — re-render so the
        // new map actually appears.
        dependencies.onMapTransition?.();
        return;
      }
      // Hunting is the rancher's choice: with it off you walk the tall grass
      // in peace, which is how you get across your own paddock without a
      // race every three steps.
      if (finalState.hunting && isOnWildEncounterTile(finalState)) {
        const wildDna =
          dependencies.nextWildDna?.(finalState.currentMapId) ??
          `wild${Math.random().toString(36).slice(2, 12)}`;
        // NOTE: nothing is recorded here. A wild genome is only yours if you
        // beat the thing in a race — the renderer owns that verdict.
        commit({
          ...finalState,
          isMoving: false,
          movementTarget: null,
        });
        dependencies.onEncounterStart("wild", wildDna, null);
        return;
      }
      commit(setMovementTarget(finalState, null, false));
    });

    return state;
  }

  function setFlagInput(flag: string, value: boolean): WorldState {
    return commit({
      ...state,
      flags: { ...state.flags, [flag]: value },
    });
  }

  function mapForState(state: WorldState) {
    return getMap(state.currentMapId) ?? null;
  }

  const BADGE_BY_MAP: Record<string, string> = {
    starter_town: "Grassland Brand",
    gym_1: "Grassland Brand",
    route_2: "Salt Road Brand",
    gym_2: "Salt Road Brand",
    hills_map: "Highland Brand",
    rocky_map: "Canyon Brand",
    ice_map: "Perimeter Brand",
  };

  function awardBadgeAndReport(badgeOrMapId: string): WorldState {
    const badge = BADGE_BY_MAP[badgeOrMapId] ?? badgeOrMapId;
    const updated = awardBadge(state, badge);
    commit(updated);
    dependencies.onBadgeAwarded(badge);
    return state;
  }

  return {
    get state() {
      return state;
    },
    interact,
    move,
    advanceDialogue: advanceDialogueInput,
    chooseDialogue: chooseDialogueInput,
    speakLine,
    speakNpc,
    currentDialogueNode,
    setFlag: setFlagInput,
    _setState: (next: WorldState) => commit(next),
    _awardBadge: awardBadgeAndReport,
  } as OverworldInputs & {
    _setState: (next: WorldState) => void;
    _awardBadge: (badge: string) => WorldState;
  };
}

export type OverworldController = ReturnType<typeof createOverworldInputs>;
