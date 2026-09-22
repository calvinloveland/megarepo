/**
 * Input: keys in, game actions out.
 *
 * The engine never sees a KeyboardEvent. It sees an action — "confirm", "left"
 * — which means the same game can be driven by a keyboard, an on-screen pad, a
 * gamepad, or a test, and all four go through the same rules.
 */

export type GameAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "cancel"
  | "menu"
  | "action";

export const GAME_ACTIONS: readonly GameAction[] = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "cancel",
  "menu",
  "action",
];

/** Arrow keys and WASD move; Z/Enter/Space confirm; Esc cancels. */
export const DEFAULT_KEY_BINDINGS: Readonly<Record<string, GameAction>> = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
  z: "confirm",
  enter: "confirm",
  " ": "confirm",
  escape: "cancel",
  x: "cancel",
  m: "menu",
  e: "action",
};

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** A stable name for a key, so "ArrowUp" and "arrowup" agree. */
export function normalizeKey(input: string | KeyLike): string {
  const raw = typeof input === "string" ? input : input.key;
  if (raw === " ") {
    return " ";
  }
  return raw.toLowerCase();
}

export function actionForKey(
  input: string | KeyLike,
  bindings: Readonly<Record<string, GameAction>> = DEFAULT_KEY_BINDINGS,
): GameAction | null {
  if (typeof input !== "string") {
    // Never steal a browser shortcut: Ctrl/Meta/Alt+key is not a game input.
    if (input.ctrlKey || input.metaKey || input.altKey) {
      return null;
    }
  }
  return bindings[normalizeKey(input)] ?? null;
}

/** A small buffer for real-time key events, drained by the game loop. */
export class InputQueue {
  private readonly pending: GameAction[] = [];

  constructor(private readonly limit = 8) {}

  push(action: GameAction): void {
    this.pending.push(action);
    while (this.pending.length > this.limit) {
      this.pending.shift();
    }
  }

  take(): GameAction | null {
    return this.pending.shift() ?? null;
  }

  size(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending.length = 0;
  }
}
