# The engine

Vroomon is two games in one trenchcoat — a top-down RPG (walk, talk, shop,
maze, hunt) and a DNA evolution simulator (breed, race, collect). Both are
built on **`electron/src/engine/`**, a headless-first kernel that owns the
boring parts so gameplay is content rather than code.

The rule that makes it an engine rather than a folder of helpers:

> **Nothing in `src/engine/` touches `window`, `document`, or a canvas.**

A renderer asks the engine for `game.view()` — the map, the camera, the actors
with pixel positions, any open conversation, any open shop — and decides
everything about how that looks. That is the whole seam. It is also why the
engine is testable at full speed: the demo game is played end to end in
`tests/engine/engine-game.test.ts` in ten milliseconds with no browser.

## What is in it

| Module | Job |
| --- | --- |
| `rng.ts` | Deterministic randomness (`createRng(seed)`), so a seed rebuilds the same world. |
| `grid.ts` | `Grid<T>`, tile keys, flood fill, shortest path. |
| `tiles.ts` | Tile definitions: solid, encounter table, tags. A map naming an unknown tile is a startup error. |
| `direction.ts` | Facing and its vectors. |
| `schedule.ts` | NPC routines: where a person stands at each phase of the day, when they are off duty, and where the phases start (configurable — a five-minute day and a twenty-minute one do not have the same afternoon). |
| `map.ts` | `defineMap` (validating), warps, reachability, whole-graph checks — including the routine checks: a stop on a tile nobody can stand on, and two people in one tile at any hour of the day. |
| `actors.ts` | Tile-by-tile movement: destination + origin + progress, so collision is exact and drawing is smooth. |
| `camera.ts` | Centred, clamped, optionally eased. |
| `inventory.ts` | Items and coins, as counts that never go negative. |
| `dialogue.ts` | The conversation graph: nodes, conditions, options, effects, and a `ScriptHost` the game implements. |
| `shop.ts` | Stock, prices, buy/sell, restock, snapshots. |
| `maze.ts` | Maze generation (recursive backtracker), braiding, rooms, a solver, and connectivity checks. |
| `collection.ts` | Specimens, a genome codec, breeding, the herd book, one generation of selection. |
| `save.ts` | Versioned saves and migrations; a newer save is refused rather than half-read. |
| `input.ts` | Keys → game actions. The engine never sees a `KeyboardEvent`. |
| `scene.ts` | A stack of scenes over the map (menus, minigames, title screens). |
| `game.ts` | The integration: content in, a walkable world out; also the `ScriptHost`. |
| `demo/hedge-town.ts` | A complete little game in one file. Start here. |

## Authoring a game

`demo/hedge-town.ts` is the acceptance test for "is this usable?" — a town, a
shop, a generated maze, a lost child, an encounter table, and a stranger at the
end, in a few hundred lines of data. The shape is:

```ts
const game = new Game({
  tilesets: [{ id: "hedge-town", tiles: HEDGE_TOWN_TILES }],
  maps: [town, shopInterior, mazeMap, hollow],
  dialogues: HEDGE_TOWN_DIALOGUES,
  shops: HEDGE_TOWN_SHOPS,
  items: HEDGE_TOWN_ITEMS,
  encounters: HEDGE_TOWN_ENCOUNTERS,
});
game.start("town", 3, 8, "right");
game.input("confirm");   // talk to whoever is in front of you
game.update(16);         // one frame; steps finish, warps fire, the day moves
game.view();             // everything a renderer needs, and nothing else
```

A conversation is a graph. A node is a line; `options` are the branches;
`when` hides a branch the player has not earned; `effects` are what changes:

```ts
{
  id: "hello",
  text: "Wren wipes her hands on the apron.",
  effects: [{ kind: "set-flag", flag: "met-wren" }],
  options: [
    { label: "What is baking?", next: "wares" },
    { label: "Just passing.", next: null },
  ],
}
```

Effects can run game verbs (`shop:bakery`, `warp:town:4:4`, `encounter:meadow`)
and games can register their own with `commands`. An unknown command is
reported in `session.diagnostics` rather than swallowed, because a typo in a
conversation is a content bug and should read like one.

## Where Vroomon uses it

- **Routine validation.** Vroomon learned the hard way that a keeper's routine
  can walk them into a hedge, that two people can be tidy at dawn and standing
  in one another at dusk, and that hours are a fraction of the day. Those checks
  now run in `defineMap`, so any game built on the engine gets them for free
  and no game has to re-learn them one map at a time.

- **The Marrow Hedge Maze** (`renderer/world/hedge-maze.ts`) is generated, not
  hand-drawn: `buildHedgeMaze()` asks the engine for a maze and returns
  `TileKind[][]`, the gate, the landing and three safe spots. `maps.ts` wires
  it to the orchard.
- The interesting rule in that file is **where people may stand**. A maze is a
  tree of corridors; a keeper standing in a corridor is a wall, and a keeper
  dropped on the route to the middle cuts the maze in half with no error
  anywhere. So every keeper stands on a **dead end** — blocking a leaf costs
  one tile and nothing else — and the three spots are chosen by distance from
  the gate: one near, one half-way, one at the far end. That is a property, so
  it is tested that way: flood the maze with that tile blocked and assert
  nothing else was lost.
- The hedge maze's wild grass is Grassland, declared in
  `core/wild.ts` next to every other hunting ground — the maze is a hunting
  ground, not a corridor.

## What is not ported yet

The engine is the target, not a rewrite that has already happened. Still on the
old footing, in order of how much it would buy:

1. **`renderer.ts`'s overworld state machine.** `world-state.ts` and
   `overworld-controller.ts` implement dialogue, flags and movement in
   vroomon's own terms. They work, and they are the largest remaining
   duplication of the engine.
2. **The shop counter.** `core/market.ts` prices and trades without an
   `Inventory`.
3. **The herd book.** `Collection` (capacity, provenance, `descendantsOf`) is
   the shape `heritage.ts` and the Hall of Fame already implement by hand.

Already moved:

- **NPC routines** — `renderer/world/routines.ts` is now an adapter, not a
  second implementation: `engine/schedule.ts` owns the five phases, the walk
  back through the day for a missing slot (and forward, when there is nothing
  earlier), and the wrapping shift. Standing and greetings stayed, because
  those are about *this* world knowing *this* rancher.

The migration order matters less than the rule: new gameplay should reach for
the engine first, and each port should delete the duplicate rather than wrap
it.

## Running the engine tests

```bash
cd active/games/vroomon/electron
npx vitest run tests/engine        # the engine's own suite
npx vitest run tests/engine/engine-game.test.ts   # the demo, played end to end
```
