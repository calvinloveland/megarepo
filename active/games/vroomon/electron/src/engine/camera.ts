/**
 * Camera: centred on the player, clamped to the map.
 *
 * A camera that follows without clamping shows the void beyond the border; one
 * that clamps without centring sits in the corner. Both are one line apart and
 * both look wrong, so the rule lives here and is tested once.
 */

export interface Size {
  width: number;
  height: number;
}

export interface CameraState {
  x: number;
  y: number;
}

export interface CameraOptions {
  /** Where the camera wants to be centred, in world pixels. */
  target: { x: number; y: number };
  viewport: Size;
  /** The whole map, in pixels. */
  world: Size;
  /** 0..1 follow factor; 1 snaps. Defaults to 1 for testable behaviour. */
  smoothing?: number;
  /** The camera's current position, required for smoothing. */
  current?: CameraState;
}

export function cameraPosition(options: CameraOptions): CameraState {
  const { target, viewport, world } = options;
  const desired = {
    x: clampAxis(target.x - viewport.width / 2, world.width, viewport.width),
    y: clampAxis(target.y - viewport.height / 2, world.height, viewport.height),
  };
  const smoothing = options.smoothing ?? 1;
  const current = options.current;
  if (!current || smoothing >= 1) {
    return { x: Math.round(desired.x), y: Math.round(desired.y) };
  }
  const factor = Math.max(0, Math.min(1, smoothing));
  return {
    x: Math.round(current.x + (desired.x - current.x) * factor),
    y: Math.round(current.y + (desired.y - current.y) * factor),
  };
}

/** A viewport centred on the actor, in the actor's pixel space. */
export function cameraForActor(
  actorPixelPosition: { x: number; y: number },
  tileSize: number,
  viewport: Size,
  world: Size,
  smoothing?: number,
  current?: CameraState,
): CameraState {
  return cameraPosition({
    target: {
      x: actorPixelPosition.x + tileSize / 2,
      y: actorPixelPosition.y + tileSize / 2,
    },
    viewport,
    world,
    ...(smoothing === undefined ? {} : { smoothing }),
    ...(current === undefined ? {} : { current }),
  });
}

/** Which tiles are on screen, as an inclusive-exclusive rectangle. */
export function visibleTileRange(
  camera: CameraState,
  tileSize: number,
  viewport: Size,
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.floor(camera.x / tileSize),
    minY: Math.floor(camera.y / tileSize),
    maxX: Math.ceil((camera.x + viewport.width) / tileSize),
    maxY: Math.ceil((camera.y + viewport.height) / tileSize),
  };
}

function clampAxis(offset: number, worldSize: number, viewportSize: number): number {
  if (worldSize <= viewportSize) {
    // The whole map fits: centre it instead of pinning it to the top-left.
    return (worldSize - viewportSize) / 2;
  }
  return Math.max(0, Math.min(worldSize - viewportSize, offset));
}
