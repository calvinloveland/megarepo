import { describe, expect, it } from "vitest";

import { createSaveRegistry, decodeSave, encodeSave } from "../../src/engine/save.js";
import { InputQueue, actionForKey, normalizeKey } from "../../src/engine/input.js";
import { SceneStack, type Scene } from "../../src/engine/scene.js";

describe("saves", () => {
  it("round-trips data through an envelope", () => {
    const registry = createSaveRegistry(1);
    const text = encodeSave({ coins: 7 }, registry, new Date("2026-09-15T12:00:00Z"));
    const decoded = decodeSave(text, registry);
    expect(decoded).toEqual({ data: { coins: 7 }, version: 1, savedAt: "2026-09-15T12:00:00.000Z", migratedFrom: null });
  });

  it("walks an old save forward one migration at a time", () => {
    const registry = createSaveRegistry(3, {
      1: (data) => ({ ...(data as Record<string, unknown>), coins: 0 }),
      2: (data) => ({ ...(data as Record<string, unknown>), herd: [] }),
    });
    const old = JSON.stringify({ version: 1, savedAt: "x", data: { mapId: "town" } });
    const decoded = decodeSave(old, registry);
    expect(decoded?.version).toBe(3);
    expect(decoded?.migratedFrom).toBe(1);
    expect(decoded?.data).toEqual({ mapId: "town", coins: 0, herd: [] });
  });

  it("refuses garbage, a future save, and a gap in the chain", () => {
    const registry = createSaveRegistry(2, { 1: (data) => data });
    expect(decodeSave("not json", registry)).toBeNull();
    expect(decodeSave("[]", registry)).toBeNull();
    expect(decodeSave(JSON.stringify({ data: 1 }), registry)).toBeNull();
    expect(decodeSave(JSON.stringify({ version: 99, data: {} }), registry)).toBeNull();
    expect(decodeSave(JSON.stringify({ version: 1, data: {} }), createSaveRegistry(2))).toBeNull();
  });

  it("validates its own version and migrations", () => {
    expect(() => createSaveRegistry(0)).toThrow(/positive integer/);
    expect(() => createSaveRegistry(2, { 5: (data) => data })).toThrow(/outside/);
  });
});

describe("input", () => {
  it("maps keys to actions and ignores browser shortcuts", () => {
    expect(actionForKey("ArrowUp")).toBe("up");
    expect(actionForKey({ key: "w" })).toBe("up");
    expect(actionForKey({ key: "Enter" })).toBe("confirm");
    expect(actionForKey({ key: " " })).toBe("confirm");
    expect(actionForKey({ key: "Escape" })).toBe("cancel");
    expect(actionForKey({ key: "q" })).toBeNull();
    expect(actionForKey({ key: "z", ctrlKey: true })).toBeNull();
    expect(actionForKey({ key: "z" }, { q: "confirm" })).toBeNull();
    expect(actionForKey({ key: "q" }, { q: "confirm" })).toBe("confirm");
    expect(normalizeKey("ArrowUp")).toBe("arrowup");
    expect(normalizeKey(" ")).toBe(" ");
  });

  it("buffers actions and drops the oldest under pressure", () => {
    const queue = new InputQueue(2);
    queue.push("up");
    queue.push("down");
    queue.push("confirm");
    expect(queue.size()).toBe(2);
    expect(queue.take()).toBe("down");
    expect(queue.take()).toBe("confirm");
    expect(queue.take()).toBeNull();
    queue.push("left");
    queue.clear();
    expect(queue.size()).toBe(0);
  });
});

describe("scene stack", () => {
  const record = () => {
    const log: string[] = [];
    const scene = (id: string, modal: boolean, consume: boolean): Scene => ({
      id,
      modal,
      enter: () => log.push(`enter:${id}`),
      exit: () => log.push(`exit:${id}`),
      update: (deltaMs) => log.push(`update:${id}:${deltaMs}`),
      input: (action) => {
        log.push(`input:${id}:${action}`);
        return consume;
      },
    });
    return { log, scene };
  };

  it("runs enter/exit/update in stack order", () => {
    const { log, scene } = record();
    const stack = new SceneStack();
    stack.push(scene("map", false, false));
    stack.push(scene("menu", true, true));
    expect(stack.depth).toBe(2);
    expect(stack.top()?.id).toBe("menu");
    stack.update(16);
    expect(log).toEqual(["enter:map", "enter:menu", "update:map:16", "update:menu:16"]);
    expect(stack.pop()?.id).toBe("menu");
    expect(log).toContain("exit:menu");
    stack.clear();
    expect(stack.depth).toBe(0);
  });

  it("lets the top scene consume, and a modal scene swallow the rest", () => {
    const { scene } = record();
    const stack = new SceneStack();
    stack.push(scene("map", false, false));
    expect(stack.input("confirm")).toBe(false);
    stack.push(scene("quiet-modal", true, false));
    expect(stack.input("confirm")).toBe(true);
    stack.push(scene("hungry", true, true));
    expect(stack.input("confirm")).toBe(true);
  });

  it("replaces and removes scenes by id", () => {
    const { scene } = record();
    const stack = new SceneStack();
    stack.push(scene("a", true, false));
    stack.push(scene("b", true, false));
    stack.replace(scene("c", true, false));
    expect(stack.all().map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(stack.remove("c")).toBe(true);
    expect(stack.remove("c")).toBe(false);
    expect(stack.all().map((entry) => entry.id)).toEqual(["a"]);
  });
});
