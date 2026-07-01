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
    vroomdex: [],
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
  return {
    ...state,
    dialogueQueue: [nextDialogue],
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
    currentEncounter:
      onComplete && onComplete !== "vroomdex"
        ? {
            kind: onComplete,
            returnMap: state.currentMapId,
          }
        : state.currentEncounter,
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
