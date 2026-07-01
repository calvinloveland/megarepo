import { getMap, isTilePassable } from "./maps.js";
import {
  attemptMove,
  findAdjacentNpc,
  isAtEdgeTransition,
  isOnWildEncounterTile,
  startMoveAnimation,
} from "./overworld-renderer.js";
import {
  advanceDialogue,
  awardBadge,
  endDialogue,
  recordEncounterDna,
  setMovementTarget,
  setPlayerFacing,
  startDialogue,
  transitionToMap,
} from "./world-state.js";
import {
  type Direction,
  type WorldState,
} from "./types.js";

export interface OverworldInputs {
  state: WorldState;
  interact: () => WorldState;
  move: (direction: Direction) => WorldState;
  advanceDialogue: () => WorldState;
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
    onBadgeAwarded: (badge: string) => void;
  },
): OverworldInputs {
  let state = initial;

  function commit(next: WorldState): WorldState {
    state = next;
    return state;
  }

  function interact(): WorldState {
    if (state.dialogueQueue.length > 0) {
      return commit(advanceDialogueInput());
    }

    if (state.isMoving) {
      return state;
    }

    const map = getMap(state.currentMapId);
    if (!map) {
      return state;
    }

    const npc = findAdjacentNpc(state);
    if (npc && npc.dialogue) {
      return commit(startDialogue(state, npc.id, npc.dialogue));
    }

    return state;
  }

  function advanceDialogueInput(): WorldState {
    const current = state.dialogueQueue[0];
    if (!current) {
      return state;
    }

    if (current.options && current.options.length > 0) {
      return state;
    }

    if (current.next) {
      const nextDialogue = findDialogueById(state, current.next);
      if (nextDialogue) {
        return commit(advanceDialogue(state, current.next, nextDialogue));
      }
    }

    return commit(completeDialogue(current.onComplete ?? null, current.setFlag ?? null));
  }

  function completeDialogue(
    onComplete: "wild" | "trainer" | "gym" | "vroomdex" | null,
    flag: string | null,
  ): WorldState {
    const updated = endDialogue(state, onComplete, flag);

    if (onComplete === "wild") {
      const wildDna = "wild" + Math.random().toString(36).slice(2, 12);
      dependencies.onEncounterStart("wild", wildDna, null);
      return updated;
    }

    if (onComplete === "trainer" || onComplete === "gym") {
      const npc = mapForState(state);
      const trainerDna = `trainer-${state.activeNpc ?? "rival"}`;
      const trainerName = npc?.npcs.find((n) => n.id === state.activeNpc)?.name ?? "Rival";
      dependencies.onEncounterStart(onComplete, trainerDna, trainerName);
      return updated;
    }

    if (onComplete === "vroomdex") {
      const dna = "prof" + Math.random().toString(36).slice(2, 10);
      dependencies.onVroomdexTick(dna);
      return commit({ ...updated, vroomdex: recordEncounterDna(updated, dna).vroomdex });
    }

    return updated;
  }

  function move(direction: Direction): WorldState {
    if (state.isMoving || state.dialogueQueue.length > 0) {
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
    const hasNpc = map.npcs.some(
      (npc) => npc.x === targetX && npc.y === targetY,
    );

    if (!isTilePassable(targetTile) || hasNpc) {
      return commit(setPlayerFacing(state, direction));
    }

    const moveResult = attemptMove(state, direction);
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
        return;
      }
      if (isOnWildEncounterTile(finalState)) {
        const wildDna = "wild" + Math.random().toString(36).slice(2, 12);
        dependencies.onVroomdexTick(wildDna);
        commit({
          ...recordEncounterDna(finalState, wildDna),
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

  function findDialogueById(state: WorldState, id: string) {
    const map = getMap(state.currentMapId);
    if (!map) {
      return null;
    }
    return map.npcs.find((npc) => npc.id === id)?.dialogue ?? null;
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
    gym_1: "Grass Badge",
    gym_2: "Sand Badge",
    gym_3: "Hill Badge",
    gym_4: "Rock Badge",
    gym_5: "Ice Badge",
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
    setFlag: setFlagInput,
    _setState: (next: WorldState) => commit(next),
    _awardBadge: awardBadgeAndReport,
  } as OverworldInputs & {
    _setState: (next: WorldState) => void;
    _awardBadge: (badge: string) => WorldState;
  };
}

export type OverworldController = ReturnType<typeof createOverworldInputs>;
