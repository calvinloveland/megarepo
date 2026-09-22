import { describe, expect, it } from "vitest";

import { Game, createGameSaveRegistry, type GameContent } from "../../src/engine/game.js";
import {
  HEDGE_TOWN_CONTENT,
  HEDGE_TOWN_MAZE,
  createHedgeTownGame,
} from "../../src/engine/demo/hedge-town.js";
import { isMazeConnected, solveMaze } from "../../src/engine/maze.js";

const viewActor = (game: Game, id: string) => game.view().actors.find((actor) => actor.id === id);

/** Walk until the player stops moving, so a test can cross a few tiles. */
function walk(game: Game, direction: "up" | "down" | "left" | "right", tiles = 1): void {
  for (let step = 0; step < tiles; step += 1) {
    game.tryMove(direction);
    game.update(200);
  }
}

describe("hedge town", () => {
  it("builds a walkable town out of content", () => {
    const game = createHedgeTownGame();
    const view = game.view();
    expect(view.map.id).toBe("town");
    expect(view.map.name).toBe("Hedge Town");
    expect(view.clock.phase).toBe("dawn");
    expect(view.actors.map((actor) => actor.id).sort()).toEqual(["baker", "loiterer", "player"]);
    expect(view.dialogue).toBeNull();
    expect(view.shop).toBeNull();
    expect(view.sceneId).toBeNull();
  });

  it("moves one tile at a time and turns against a wall", () => {
    const game = createHedgeTownGame();
    game.start("town", 1, 1, "down");
    expect(game.tryMove("down")).toBe(true);
    expect(game.playerState.x).toBe(1);
    expect(game.playerState.y).toBe(2);
    expect(game.playerState.stepFrom).toEqual({ x: 1, y: 1 });
    game.update(200);
    expect(game.playerState.stepFrom).toBeNull();

    // The town border is trees; walking into it turns rather than moves.
    game.start("town", 1, 1, "down");
    expect(game.tryMove("up")).toBe(false);
    expect(game.playerState.facing).toBe("up");
    expect(game.playerState.y).toBe(1);
    expect(game.canStepOnto(1, 0)).toBe(false);
    expect(game.canStepOnto(1, 2)).toBe(true);
  });

  it("stops the world while a conversation is open", () => {
    const game = createHedgeTownGame();
    game.start("town", 3, 8, "up");
    expect(game.input("confirm")).toBe(true);
    const view = game.view();
    expect(view.dialogue?.speaker).toBe("Old Marrow");
    expect(view.dialogue?.text).toContain("Old Marrow");
    expect(game.isBusy).toBe(true);
    expect(game.tryMove("right")).toBe(false);
    expect(game.playerState.x).toBe(3);
  });

  it("remembers a first meeting and skips it on the next visit", () => {
    const game = createHedgeTownGame();
    game.start("town", 3, 8, "up");
    game.input("confirm");
    // The first line chains into the line he always says.
    expect(game.view().dialogue?.text).toContain("Grass in the hedge");
    game.input("confirm");
    expect(game.view().dialogue?.text).toContain("Still here");
    expect(game.getFlag("marrow-nodded")).toBe(true);
    game.input("confirm");
    expect(game.view().dialogue?.options).toEqual(["Do you ever go home?", "Leave him to it."]);
    expect(game.choose(0)).toBe(true);
    expect(game.view().dialogue?.text).toContain("I am home");

    // A second meeting starts at the repeat line, not the first one.
    game.closeDialogue();
    game.input("confirm");
    expect(game.view().dialogue?.text).toContain("Still here");
  });

  it("opens a shop from a dialogue option and trades through it", () => {
    const game = createHedgeTownGame();
    game.start("town", 8, 4, "up");
    game.run("coins", "20");
    game.input("confirm");
    expect(game.view().dialogue?.speaker).toBe("Baker Wren");
    expect(game.choose(0)).toBe(true);
    expect(game.view().dialogue?.text).toContain("Loaves");
    expect(game.choose(0)).toBe(true);
    expect(game.view().dialogue).toBeNull();
    expect(game.view().shop?.id).toBe("bakery");
    expect(game.view().shop?.offers.map((offer) => offer.item)).toEqual(["bread", "pie", "lantern"]);

    expect(game.buy("bread", 2)).toMatchObject({ ok: true, item: "bread", count: 2, coins: 14 });
    expect(game.countItem("bread")).toBe(2);
    expect(game.sell("bread")).toMatchObject({ ok: true, item: "bread", count: 1, coins: 15 });
    expect(game.buy("lantern")).toMatchObject({ ok: false, reason: "no-money" });

    game.input("cancel");
    expect(game.view().shop).toBeNull();
  });

  it("walks through the door into the generated maze and back out", () => {
    const game = createHedgeTownGame();
    game.start("town", 8, 8, "down");
    walk(game, "down");
    expect(game.view().map.id).toBe("maze");
    expect(game.playerState.x).toBe(1);
    expect(game.playerState.y).toBe(2);

    // The entrance tile is the way back; it must not be the way you arrived.
    walk(game, "up");
    expect(game.view().map.id).toBe("town");
    expect(game.playerState.x).toBe(8);
    expect(game.playerState.y).toBe(8);
  });

  it("rolls an encounter on tall grass and hands it back", () => {
    const certain: GameContent = {
      ...HEDGE_TOWN_CONTENT,
      encounters: [{ id: "meadow", chance: 1, entries: ["hedge-hare"] }],
    };
    const game = new Game(certain);
    game.start("town", 2, 1, "down");
    const seen: string[] = [];
    game.on("encounter", (event) => seen.push(event.entry));
    walk(game, "down");
    expect(seen).toEqual(["hedge-hare"]);
    expect(game.view().encounter).toEqual({ table: "meadow", entry: "hedge-hare" });
    // A pending encounter stops the world until it is answered.
    expect(game.tryMove("down")).toBe(false);
    expect(game.input("confirm")).toBe(true);
    expect(game.resolveEncounter()).toBeNull();

    const quiet = new Game({ ...HEDGE_TOWN_CONTENT, encounters: [{ id: "meadow", chance: 0, entries: ["x"] }] });
    quiet.start("town", 2, 1, "down");
    walk(quiet, "down");
    expect(quiet.view().encounter).toBeNull();
    expect(quiet.rollEncounter("no-such-table")).toBeNull();
  });

  it("moves people with the day", () => {
    const game = createHedgeTownGame();
    game.setDayFraction(0.5);
    expect(game.view().clock.phase).toBe("afternoon");
    expect(viewActor(game, "baker")).toMatchObject({ x: 5, y: 5 });

    game.setDayFraction(0.9);
    expect(game.view().clock.phase).toBe("night");
    expect(viewActor(game, "baker")).toBeUndefined();
    expect(viewActor(game, "loiterer")).toBeDefined();
  });

  it("carries flags, coins and position through a save", () => {
    const game = createHedgeTownGame();
    game.run("coins", "30");
    game.run("give", "bread:3");
    game.setFlag("met-wren", true);
    game.transitionTo("maze", 1, 2);
    const text = game.save();

    const restored = createHedgeTownGame();
    expect(restored.load(text)).toBe(true);
    expect(restored.mapId).toBe("maze");
    expect(restored.playerState.x).toBe(1);
    expect(restored.coins()).toBe(30);
    expect(restored.countItem("bread")).toBe(3);
    expect(restored.getFlag("met-wren")).toBe(true);

    // A save from a newer build is refused rather than half-read.
    const future = JSON.stringify({ version: 99, savedAt: "", data: { mapId: "town" } });
    expect(restored.load(future)).toBe(false);
    expect(restored.load("not json")).toBe(false);
    // A save naming a map this build does not have is refused too.
    expect(
      restored.load(
        JSON.stringify({ version: 1, savedAt: "", data: { mapId: "atlantis", inventory: { coins: 0, items: {} }, flags: {}, collection: [] } }),
      ),
    ).toBe(false);
    expect(createGameSaveRegistry().version).toBe(1);
  });

  it("freezes the map behind a pushed scene", () => {
    const game = createHedgeTownGame();
    let inputCount = 0;
    game.pushScene({
      id: "title",
      input: () => {
        inputCount += 1;
        return true;
      },
    });
    expect(game.view().sceneId).toBe("title");
    expect(game.input("right")).toBe(true);
    expect(inputCount).toBe(1);
    expect(game.tryMove("left")).toBe(false);
    expect(game.playerState.x).toBe(3);
    game.popScene();
    expect(game.view().sceneId).toBeNull();
    expect(game.tryMove("left")).toBe(true);
  });

  it("ships a maze that is connected and solvable from end to end", () => {
    expect(isMazeConnected(HEDGE_TOWN_MAZE)).toBe(true);
    const path = solveMaze(HEDGE_TOWN_MAZE, HEDGE_TOWN_MAZE.entrance, HEDGE_TOWN_MAZE.exit);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(HEDGE_TOWN_MAZE.width);
    expect(path![0]).toEqual(HEDGE_TOWN_MAZE.entrance);
    expect(path!.at(-1)).toEqual(HEDGE_TOWN_MAZE.exit);
  });
});

describe("game content validation", () => {
  const tileset = [{ id: "t", tiles: [{ id: "floor" }, { id: "wall", solid: true }] }];

  it("refuses a map that names a tile its tileset does not have", () => {
    expect(
      () =>
        new Game({
          tilesets: tileset,
          maps: [{ id: "m", name: "M", tileset: "t", tiles: [["floor", "lava"]] }],
        }),
    ).toThrow(/not in tileset "t"/);
  });

  it("refuses maps that strand the player or hide a warp", () => {
    expect(
      () =>
        new Game({
          tilesets: tileset,
          maps: [{ id: "m", name: "M", tileset: "t", tiles: [["floor"]] }],
        }),
    ).toThrow(/no exits/);

    expect(
      () =>
        new Game({
          tilesets: tileset,
          maps: [
            { id: "a", name: "A", tileset: "t", tiles: [["floor", "wall"]], warps: [{ at: { x: 0, y: 0 }, toMap: "b", to: { x: 1, y: 0 } }] },
            { id: "b", name: "B", tileset: "t", tiles: [["floor", "wall"]], warps: [{ at: { x: 0, y: 0 }, toMap: "a", to: { x: 0, y: 0 } }] },
          ],
        }),
    ).toThrow(/solid tile/);
  });

  it("refuses a conversation that points at a node nobody wrote", () => {
    expect(
      () =>
        new Game({
          tilesets: tileset,
          maps: [
            {
              id: "a",
              name: "A",
              tileset: "t",
              tiles: [["floor", "floor"]],
              warps: [{ at: { x: 0, y: 0 }, toMap: "b", to: { x: 1, y: 0 } }],
            },
            {
              id: "b",
              name: "B",
              tileset: "t",
              tiles: [["floor", "floor"]],
              warps: [{ at: { x: 0, y: 0 }, toMap: "a", to: { x: 1, y: 0 } }],
            },
          ],
          dialogues: [{ id: "d", start: "a", nodes: [{ id: "a", text: "hi", next: "b" }] }],
        }),
    ).toThrow(/missing node "b"/);
  });
});
