import { getMap, isTilePassable } from "./maps.js";
import {
  drawNpc,
  drawPlayer,
  drawTile,
} from "./sprites.js";
import {
  PLAYER_MOVE_DURATION_MS,
  TILE_SIZE,
  type Direction,
  type Tilemap,
  type WorldState,
} from "./types.js";

export interface OverworldRenderFrame {
  map: Tilemap;
  tick: number;
  world: WorldState;
}

export function renderOverworld(
  canvas: HTMLCanvasElement,
  frame: OverworldRenderFrame,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const { map, tick, world } = frame;
  const width = canvas.width;
  const height = canvas.height;

  ctx.fillStyle = map.ambientColor;
  ctx.fillRect(0, 0, width, height);

  const cameraX = computeCameraX(world, map, width);
  const cameraY = computeCameraY(world, map, height);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = map.tiles[y]?.[x] ?? "grass";
      const px = x * TILE_SIZE - cameraX;
      const py = y * TILE_SIZE - cameraY;
      drawTile(ctx, tile, px, py, TILE_SIZE, tick);
    }
  }

  const sortedEntities: Array<{ y: number; draw: (px: number) => void }> = [];
  for (const npc of map.npcs) {
    sortedEntities.push({
      y: npc.y,
      draw: (px) => {
        const npcPx = npc.x * TILE_SIZE - cameraX;
        const npcPy = npc.y * TILE_SIZE - cameraY;
        if (
          npcPx < -TILE_SIZE ||
          npcPx > width ||
          npcPy < -TILE_SIZE ||
          npcPy > height
        ) {
          return;
        }
        drawNpc(ctx, npc.sprite, npcPx, npcPy, TILE_SIZE, npc.facing, tick);
      },
    });
  }
  sortedEntities.push({
    y: world.playerY,
    draw: (px) => {
      const drawX =
        world.movementTarget && world.isMoving
          ? interpolate(
              world.playerX,
              world.movementTarget.x,
              easeOutCubic(currentMoveProgress(tick)),
            )
          : world.playerX;
      const drawY =
        world.movementTarget && world.isMoving
          ? interpolate(
              world.playerY,
              world.movementTarget.y,
              easeOutCubic(currentMoveProgress(tick)),
            )
          : world.playerY;
      const playerPx = drawX * TILE_SIZE - cameraX;
      const playerPy = drawY * TILE_SIZE - cameraY;
      drawPlayer(ctx, playerPx, playerPy, TILE_SIZE, world.playerFacing, tick);
    },
  });
  sortedEntities.sort((left, right) => left.y - right.y);
  for (const entity of sortedEntities) {
    entity.draw(0);
  }
}

function computeCameraX(world: WorldState, map: Tilemap, width: number): number {
  const playerX = world.movementTarget && world.isMoving
    ? interpolate(
        world.playerX,
        world.movementTarget.x,
        easeOutCubic(currentMoveProgress(performance.now())),
      )
    : world.playerX;
  const mapWidthPx = map.width * TILE_SIZE;
  const desired = playerX * TILE_SIZE - width / 2 + TILE_SIZE / 2;
  if (mapWidthPx <= width) {
    return (mapWidthPx - width) / 2;
  }
  return Math.max(0, Math.min(mapWidthPx - width, desired));
}

function computeCameraY(world: WorldState, map: Tilemap, height: number): number {
  const playerY = world.movementTarget && world.isMoving
    ? interpolate(
        world.playerY,
        world.movementTarget.y,
        easeOutCubic(currentMoveProgress(performance.now())),
      )
    : world.playerY;
  const mapHeightPx = map.height * TILE_SIZE;
  const desired = playerY * TILE_SIZE - height / 2 + TILE_SIZE / 2;
  if (mapHeightPx <= height) {
    return (mapHeightPx - height) / 2;
  }
  return Math.max(0, Math.min(mapHeightPx - height, desired));
}

let lastMoveStartedAt = 0;

export function startMoveAnimation(): void {
  lastMoveStartedAt = performance.now();
}

function currentMoveProgress(tick: number): number {
  return Math.min(1, (tick - lastMoveStartedAt) / PLAYER_MOVE_DURATION_MS);
}

function interpolate(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function attemptMove(
  world: WorldState,
  direction: Direction,
): { state: WorldState; transitionKey: string | null } {
  if (world.isMoving || world.activeNpc) {
    return { state: world, transitionKey: null };
  }

  const map = getMap(world.currentMapId);
  if (!map) {
    return { state: world, transitionKey: null };
  }

  const facing = direction;
  const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  const targetX = world.playerX + dx;
  const targetY = world.playerY + dy;

  if (
    targetX < 0 ||
    targetX >= map.width ||
    targetY < 0 ||
    targetY >= map.height
  ) {
    return {
      state: { ...world, playerFacing: facing },
      transitionKey: null,
    };
  }

  const targetTile = map.tiles[targetY]?.[targetX] ?? "grass";
  const npcAtTarget = map.npcs.find(
    (npc) => npc.x === targetX && npc.y === targetY,
  );

  if (npcAtTarget) {
    return {
      state: { ...world, playerFacing: facing },
      transitionKey: null,
    };
  }

  if (!isTilePassable(targetTile)) {
    return {
      state: { ...world, playerFacing: facing },
      transitionKey: null,
    };
  }

  const transitionKey = `${targetX},${targetY}`;
  const transition = map.transitions[transitionKey];

  if (transition) {
    return {
      state: {
        ...world,
        playerFacing: facing,
        movementTarget: { x: targetX, y: targetY },
        isMoving: true,
      },
      transitionKey,
    };
  }

  startMoveAnimation();
  return {
    state: {
      ...world,
      playerFacing: facing,
      playerX: targetX,
      playerY: targetY,
      movementTarget: { x: targetX, y: targetY },
      isMoving: true,
    },
    transitionKey: null,
  };
}

export function isAtEdgeTransition(
  world: WorldState,
): { mapId: string; x: number; y: number; facing: Direction } | null {
  const map = getMap(world.currentMapId);
  if (!map) {
    return null;
  }
  const transition = map.transitions[`${world.playerX},${world.playerY}`];
  if (!transition) {
    return null;
  }
  return {
    mapId: transition.mapId,
    x: transition.toX,
    y: transition.toY,
    facing: transition.facing ?? "down",
  };
}

export function isOnWildEncounterTile(world: WorldState): boolean {
  const map = getMap(world.currentMapId);
  if (!map) {
    return false;
  }
  const tile = map.tiles[world.playerY]?.[world.playerX];
  return tile === "vroomgrass";
}

export function findAdjacentNpc(
  world: WorldState,
): ReturnType<typeof getNpcByPosition> {
  const map = getMap(world.currentMapId);
  if (!map) {
    return null;
  }
  const dx = world.playerFacing === "left" ? -1 : world.playerFacing === "right" ? 1 : 0;
  const dy = world.playerFacing === "up" ? -1 : world.playerFacing === "down" ? 1 : 0;
  return getNpcByPosition(map, world.playerX + dx, world.playerY + dy);
}

export function getNpcByPosition(map: Tilemap, x: number, y: number) {
  return map.npcs.find((npc) => npc.x === x && npc.y === y) ?? null;
}
