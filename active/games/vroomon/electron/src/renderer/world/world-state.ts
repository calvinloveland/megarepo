import type { DialogueSession } from "../../engine/dialogue.js";
import type { Direction, WorldState } from "./types.js";

export function createInitialWorldState(): WorldState {
  return {
    currentMapId: "starter_town",
    playerX: 7,
    playerY: 7,
    playerFacing: "down",
    badges: [],
    factionChoices: {},
    feudTiers: {},
    decor: [],
    rancherName: "",
    rancherCap: "navy",
    vroomdex: [],
    hunting: true,
    tally: {},
    timeOverride: null,
    specimenMeta: {},
    wildPacks: {},
    wildGenerations: {},
    flags: {},
    dialogue: null,
    activeNpc: null,
    currentEncounter: null,
    isMoving: false,
    movementTarget: null,
  };
}

export function setPlayerPosition(
  state: WorldState,
  x: number,
  y: number,
  facing?: Direction,
): WorldState {
  return {
    ...state,
    playerX: x,
    playerY: y,
    playerFacing: facing ?? state.playerFacing,
  };
}

export function setPlayerFacing(
  state: WorldState,
  facing: Direction,
): WorldState {
  return {
    ...state,
    playerFacing: facing,
  };
}

export function setMovementTarget(
  state: WorldState,
  target: { x: number; y: number } | null,
  isMoving: boolean,
): WorldState {
  return {
    ...state,
    movementTarget: target,
    isMoving,
  };
}

export function transitionToMap(
  state: WorldState,
  mapId: string,
  x: number,
  y: number,
  facing: Direction = "down",
): WorldState {
  return {
    ...state,
    currentMapId: mapId,
    playerX: x,
    playerY: y,
    playerFacing: facing,
    activeNpc: null,
    dialogue: null,
    isMoving: false,
    movementTarget: null,
  };
}

export function startDialogue(
  state: WorldState,
  npcId: string,
  session: DialogueSession,
): WorldState {
  return {
    ...state,
    activeNpc: npcId,
    dialogue: session,
  };
}

/**
 * The conversation is over — because the engine session closed, or because the
 * game took it away (a warp, a race card). Dropping the session runs nothing:
 * a beat nobody acknowledged did not happen.
 */
export function endDialogue(state: WorldState): WorldState {
  if (state.dialogue === null && state.activeNpc === null) {
    return state;
  }
  return {
    ...state,
    activeNpc: null,
    dialogue: null,
    currentEncounter: state.currentEncounter,
  };
}

/** Keep `activeNpc` and `dialogue` in step: a closed session is no session. */
export function syncDialogue(state: WorldState): WorldState {
  if (state.dialogue && !state.dialogue.isOpen()) {
    return endDialogue(state);
  }
  return state;
}

export function recordEncounterDna(
  state: WorldState,
  dna: string,
): WorldState {
  if (state.vroomdex.includes(dna)) {
    return state;
  }
  return {
    ...state,
    vroomdex: [...state.vroomdex, dna].slice(-200),
  };
}

export function joinFaction(
  state: WorldState,
  biomeId: string,
  factionId: string,
): WorldState {
  return {
    ...state,
    factionChoices: { ...state.factionChoices, [biomeId]: factionId },
    activeNpc: null,
    dialogue: null,
    flags: { ...state.flags, [`faction-joined-${biomeId}`]: true },
  };
}

export function awardBadge(
  state: WorldState,
  badge: string,
): WorldState {
  if (state.badges.includes(badge)) {
    return state;
  }
  return {
    ...state,
    badges: [...state.badges, badge],
  };
}

export function setFlag(
  state: WorldState,
  flag: string,
  value: boolean,
): WorldState {
  return {
    ...state,
    flags: { ...state.flags, [flag]: value },
  };
}

/** Bump a world counter (wild races won, maps walked, quests paid). */
export function addTally(state: WorldState, key: string, amount = 1): WorldState {
  const next = (state.tally?.[key] ?? 0) + amount;
  return { ...state, tally: { ...(state.tally ?? {}), [key]: next } };
}

/** Note that a map has been walked on, once. */
export function markVisited(state: WorldState, mapId: string): WorldState {
  if ((state.tally?.[`visited:${mapId}`] ?? 0) > 0) {
    return state;
  }
  return addTally(state, `visited:${mapId}`);
}
