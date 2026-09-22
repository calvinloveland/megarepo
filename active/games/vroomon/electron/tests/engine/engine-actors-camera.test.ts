import { describe, expect, it } from "vitest";

import {
  actorAt,
  actorPixel,
  advanceActor,
  advanceActors,
  beginStep,
  createActorState,
  facingTile,
  isStepping,
  occupiedTiles,
  turnTo,
  visualTile,
} from "../../src/engine/actors.js";
import { cameraForActor, cameraPosition, visibleTileRange } from "../../src/engine/camera.js";

describe("actors", () => {
  it("starts still, facing a direction", () => {
    const actor = createActorState({ id: "p", mapId: "town", x: 2, y: 3 });
    expect(actor.kind).toBe("npc");
    expect(actor.facing).toBe("down");
    expect(isStepping(actor)).toBe(false);
    expect(turnTo(actor, "left").facing).toBe("left");
    expect(turnTo(actor, "down")).toBe(actor);
  });

  it("claims the destination tile the moment a step begins", () => {
    const actor = createActorState({ id: "p", mapId: "town", x: 2, y: 3 });
    const stepping = beginStep(actor, "right", 100);
    expect(stepping.x).toBe(3);
    expect(stepping.y).toBe(3);
    expect(stepping.stepFrom).toEqual({ x: 2, y: 3 });
    expect(stepping.facing).toBe("right");
    expect(isStepping(stepping)).toBe(true);
    // A second step cannot start mid-step.
    expect(beginStep(stepping, "down")).toBe(stepping);
  });

  it("interpolates between the two tiles and lands exactly on arrival", () => {
    const actor = createActorState({ id: "p", mapId: "town", x: 2, y: 3, stepDurationMs: 100 });
    const stepping = beginStep(actor, "right", 100);
    const halfway = advanceActor(stepping, 50);
    expect(visualTile(halfway)).toEqual({ x: 2.5, y: 3 });
    expect(actorPixel(halfway, 32)).toEqual({ x: 80, y: 96 });
    const arrived = advanceActor(halfway, 60);
    expect(isStepping(arrived)).toBe(false);
    expect(arrived.x).toBe(3);
    expect(arrived.y).toBe(3);
    expect(visualTile(arrived)).toEqual({ x: 3, y: 3 });
    // Standing still is a no-op, not a new object every frame.
    expect(advanceActor(arrived, 16)).toBe(arrived);
  });

  it("reports who arrived this frame, which is when warps fire", () => {
    const standing = createActorState({ id: "a", mapId: "m", x: 0, y: 0, stepDurationMs: 100 });
    const moving = createActorState({ id: "b", mapId: "m", x: 4, y: 4, stepDurationMs: 100 });
    const first = advanceActors([standing, beginStep(moving, "up")], 40);
    expect(first.arrived).toHaveLength(0);
    const second = advanceActors(first.actors, 80);
    expect(second.arrived.map((actor) => actor.id)).toEqual(["b"]);
    expect(second.arrived[0]!.y).toBe(3);
  });

  it("names the tile in front and the tiles that are taken", () => {
    const actor = createActorState({ id: "p", mapId: "m", x: 2, y: 2, facing: "up" });
    expect(facingTile(actor)).toEqual({ x: 2, y: 1 });
    const hidden = { ...createActorState({ id: "ghost", mapId: "m", x: 5, y: 5 }), hidden: true };
    const taken = occupiedTiles([actor, hidden]);
    expect(taken.has("2,2")).toBe(true);
    expect(taken.has("5,5")).toBe(false);
    expect(actorAt([actor, hidden], 2, 2)?.id).toBe("p");
    expect(actorAt([actor, hidden], 5, 5)).toBeUndefined();
  });
});

describe("camera", () => {
  it("centres on the target, then clamps to the map", () => {
    expect(
      cameraPosition({
        target: { x: 200, y: 200 },
        viewport: { width: 100, height: 100 },
        world: { width: 1000, height: 1000 },
      }),
    ).toEqual({ x: 150, y: 150 });

    // Near the edge it stops at the border instead of showing the void.
    expect(
      cameraPosition({
        target: { x: 10, y: 10 },
        viewport: { width: 100, height: 100 },
        world: { width: 1000, height: 1000 },
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      cameraPosition({
        target: { x: 990, y: 990 },
        viewport: { width: 100, height: 100 },
        world: { width: 1000, height: 1000 },
      }),
    ).toEqual({ x: 900, y: 900 });
  });

  it("centres a map smaller than the viewport", () => {
    expect(
      cameraPosition({
        target: { x: 0, y: 0 },
        viewport: { width: 400, height: 300 },
        world: { width: 200, height: 100 },
      }),
    ).toEqual({ x: -100, y: -100 });
  });

  it("eases toward the target when given a current position", () => {
    const options = {
      target: { x: 400, y: 400 },
      viewport: { width: 100, height: 100 },
      world: { width: 1000, height: 1000 },
      current: { x: 0, y: 0 },
      smoothing: 0.5,
    };
    const first = cameraPosition(options);
    expect(first.x).toBeGreaterThan(0);
    expect(first.x).toBeLessThan(350);
    const second = cameraPosition({ ...options, current: first });
    expect(second.x).toBeGreaterThan(first.x);
  });

  it("follows an actor by its centre and reports what is on screen", () => {
    const camera = cameraForActor(
      { x: 320, y: 320 },
      32,
      { width: 160, height: 160 },
      { width: 1000, height: 1000 },
    );
    expect(camera).toEqual({ x: 256, y: 256 });
    expect(visibleTileRange(camera, 32, { width: 160, height: 160 })).toEqual({
      minX: 8,
      minY: 8,
      maxX: 13,
      maxY: 13,
    });
  });
});
