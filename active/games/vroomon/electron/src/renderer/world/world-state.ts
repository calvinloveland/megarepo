import {
  type Direction,
  type DialogueNode,
  type WorldState,
} from "./types.js";

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
    wildPacks: {},
    wildGenerations: {},
    flags: {},
    dialogueQueue: [],
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
    isMoving: false,
    movementTarget: null,
  };
}

export function startDialogue(
  state: WorldState,
  npcId: string,
  dialogue: DialogueNode,
): WorldState {
  return {
    ...state,
    activeNpc: npcId,
    dialogueQueue: [dialogue],
  };
}

export function advanceDialogue(
  state: WorldState,
  next: string,
  nextDialogue: DialogueNode,
): WorldState {
  // A flagged beat that ALSO chains onward applies its flag when the
  // player advances — setFlag must not be reserved for terminal nodes.
  const flag = state.dialogueQueue[0]?.setFlag ?? null;
  const newFlags = flag ? { ...state.flags, [flag]: true } : state.flags;
  return {
    ...state,
    dialogueQueue: [nextDialogue],
    flags: newFlags,
  };
}

export function endDialogue(
  state: WorldState,
  onComplete: DialogueNode["onComplete"],
  flag: string | null,
): WorldState {
  const newFlags = flag ? { ...state.flags, [flag]: true } : state.flags;
  return {
    ...state,
    activeNpc: null,
    dialogueQueue: [],
    flags: newFlags,
    // On-complete "encounters" (wild/trainer/gym) are fire-and-forget
    // reports via onEncounterStart — they do NOT open a persistent
    // encounter, so currentEncounter stays untouched. Previously it was
    // set here and permanently blocked persistWorldState (which bails on
    // activeNpc || currentEncounter), meaning ANY gym fight silently
    // froze world saving.
    currentEncounter: state.currentEncounter,
  };
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
    dialogueQueue: [],
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
