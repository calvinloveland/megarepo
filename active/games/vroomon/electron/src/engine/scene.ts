/**
 * Scenes: a stack of states the game can push over the map.
 *
 * Walking is the bottom of the stack. A menu, an inventory screen, a title
 * screen or a minigame is pushed on top; the top scene gets input first and can
 * consume it, so "what is on screen" and "what does this key do" have one
 * answer rather than a set of booleans checked in a different order in three
 * places.
 */

import type { GameAction } from "./input.js";

export interface SceneHost {
  push(scene: Scene): void;
  pop(): Scene | null;
  replace(scene: Scene): void;
  top(): Scene | null;
}

export interface Scene {
  readonly id: string;
  /** A modal scene blocks the map underneath it. Defaults to true. */
  readonly modal?: boolean;
  enter?(host: SceneHost): void;
  exit?(): void;
  update?(deltaMs: number): void;
  /** Return true when the scene used the action, false to let it fall through. */
  input?(action: GameAction): boolean;
}

export class SceneStack implements SceneHost {
  private readonly scenes: Scene[] = [];

  get depth(): number {
    return this.scenes.length;
  }

  top(): Scene | null {
    return this.scenes[this.scenes.length - 1] ?? null;
  }

  /** Every scene, bottom first. */
  all(): Scene[] {
    return [...this.scenes];
  }

  push(scene: Scene): void {
    this.scenes.push(scene);
    scene.enter?.(this);
  }

  pop(): Scene | null {
    const removed = this.scenes.pop() ?? null;
    removed?.exit?.();
    return removed;
  }

  replace(scene: Scene): void {
    const removed = this.scenes.pop() ?? null;
    removed?.exit?.();
    this.scenes.push(scene);
    scene.enter?.(this);
  }

  /** Remove a scene wherever it sits; useful for tearing down a whole flow. */
  remove(id: string): boolean {
    const index = this.scenes.findIndex((scene) => scene.id === id);
    if (index === -1) {
      return false;
    }
    const [removed] = this.scenes.splice(index, 1);
    removed?.exit?.();
    return true;
  }

  update(deltaMs: number): void {
    for (const scene of this.scenes) {
      scene.update?.(deltaMs);
    }
  }

  /**
   * Offer an action to the stack from the top down. A modal scene consumes
   * everything; a non-modal one can decline and let the action reach the map.
   */
  input(action: GameAction): boolean {
    for (let index = this.scenes.length - 1; index >= 0; index -= 1) {
      const scene = this.scenes[index]!;
      const consumed = scene.input?.(action) === true;
      if (consumed) {
        return true;
      }
      if (scene.modal !== false) {
        return true;
      }
    }
    return false;
  }

  clear(): void {
    while (this.scenes.length > 0) {
      this.pop();
    }
  }
}
