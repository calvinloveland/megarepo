/**
 * Facing, on its own so nothing has to import a whole actor to name a
 * direction.
 */

export type Facing = "up" | "down" | "left" | "right";

const VECTORS: Record<Facing, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function facingVector(facing: Facing): { x: number; y: number } {
  return { ...VECTORS[facing] };
}

export function oppositeFacing(facing: Facing): Facing {
  switch (facing) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

/** The directions in a stable order, so menus and tests do not shuffle. */
export const FACINGS: readonly Facing[] = ["up", "right", "down", "left"];
