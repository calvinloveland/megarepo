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
| `dialogue.ts` | The conversation graph: nodes, conditions (flags, items, coins, tallies), options, effects on entry and on leave, and a `ScriptHost` the game implements. |
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

Effects come in two timings, because content needs both. `effects` run when the
beat **appears** (the light goes on, the door opens). `onLeave` runs when the
player **acknowledges** it — advancing past it, or picking an option off it —
and beats whatever the next node does on entry. That is the timing for "you
agreed to this": a quest accepted by the option someone just chose, recorded
when they chose it rather than when the text finished drawing. Neither runs for
a conversation that was abandoned, or for a node skipped because its `when`
failed: nobody read it, so it did not happen.

A screen is a `Scene` pushed over the map. It describes what it wants drawn and
the app draws it; a modal scene stops the world behind it, so the movement keys
do not reach the map:

```ts
game.pushScene({
  id: "bag",
  view: () => ({
    id: "bag",
    title: "Bag",
    rows: [
      { label: "Coins", detail: `${game.coins()} cr` },
      ...game.inventory.items().map(({ item, count }) => ({ label: item, detail: `x${count}` })),
    ],
    footer: "Escape to close",
  }),
  input: (action) => {
    if (action === "cancel") { game.popScene(); return true; }
    return false;
  },
});
```

`onAction` in the content is how a key opens it (`menu` here); everything the
map and the overlays did not want arrives there. `Game.view().scene` comes back
with the rows. `demo/hedge-town.ts` ships exactly this bag, and
`tests/engine/engine-game.test.ts` opens it, checks that the movement keys do
not move the player, and closes it.

## Where Vroomon uses it

- **Dialogue.** `renderer/world/dialogue-bridge.ts` turns Vroomon's authored
  maps into engine scripts: one node per person, keyed by the NPC id the links
  already use, with `setFlag` and `onComplete` as `onLeave` effects (the flag
  first, then the verb). The controller is the `ScriptHost`: six `onComplete`
  verbs became commands, and `goto:` carries its map, position and optional
  landing node in the argument. The engine validates every link when the script
  is built, and a test builds one for every person in the world — so a link to a
  node nobody wrote is now a failure rather than a conversation that quietly
  ends.
- **A generated line.** The feud briefing that replaces an arena's "three,
  two, one… go" is `session.replaceText(nodeId, text)`: the game owns the words
  for a beat it computed, the session owns which node is on screen.
- **A conditioned menu.** Authored options carry an engine `when`, and the
  Brambles' warden is the first person in the world to use one: her job offer is
  on the menu until it is taken, and the question it raises replaces it once it
  has been. The second is a news gate — the hedge keeper asks after a picker,
  and the answer exists only once she has been walked out of the maze, a flag
  set by somebody else's conversation on another tile. Tests walk both swaps
  through the real content, require at least two people to gate an option, and
  refuse a gate on a flag nothing sets: an option nobody can ever see.
  A gate can read a counter rather than a flag — the ground counts the wild
  races you have won on it, so a keeper can say the gully knows you without
  waiting for the job to be paid — which is the difference between “has this
  happened” and “how much of it has”.
  A node can be conditional too, with `whenFalse` as its fallback: the
  hedge maze's picker has two openings, one for a picker who needs walking
  out and one for afterwards, because without it the second meeting was a
  rescue that had already happened — and a second free warp to the orchard.
- **Routine validation.** Vroomon learned the hard way that a keeper's routine
  can walk them into a hedge, that two people can be tidy at dawn and standing
  in one another at dusk, and that hours are a fraction of the day. Those checks
  now run in `defineMap`, so any game built on the engine gets them for free
  and no game has to re-learn them one map at a time.

- **Three mazes, generated** (`renderer/world/maze-map.ts`): `buildHedgeMaze()`,
  `buildDeepMaze()` and `buildBrambleMaze()` are three sets of options over one
  `buildMazeMap()`, which returns `TileKind[][]` plus the gate, the landing and
  three safe spots. `maps.ts` wires each to its host, and `decor.ts` takes the
  free tile the generator hands out.
- The interesting rule in that file is **where people may stand**. A maze is a
  tree of corridors; a keeper standing in a corridor is a wall, and a keeper
  dropped on the route to the middle cuts the maze in half with no error
  anywhere. So every keeper stands on a **dead end** — blocking a leaf costs
  one tile and nothing else — and the three spots are chosen by distance from
  the gate: one near, one half-way, one at the far end. That is a property, so
  it is tested that way: flood the maze with that tile blocked and assert
  nothing else was lost.
- The hedge maze's wild grass is Grassland and the Brambles' is Hill stock,
  both declared in `core/wild.ts` next to every other hunting ground — a maze
  with grass is a hunting ground, not a corridor. The Deep has no grass at all:
  it is a maze you walk for the people in it, and the builder supports that by
  taking no wild tile.

## What is not ported yet

Nothing large. Two ports that looked obvious were measured and are **not**
deletions yet; both are written up below rather than left as TODOs.

Already moved:

- **Dialogue** — `world/dialogue-bridge.ts` plus a `ScriptHost` on the
  overworld controller; `world-state.ts` no longer carries a queue. The two
  behaviours that needed a decision were settled rather than papered over: the
  engine's `onLeave` effects give Vroomon's leave-time `setFlag`, and the line
  that used to be *prepended* to an open conversation turned out to be a
  replacement all along (the next advance cleared the rest), so it is one now.
- **NPC routines** — `renderer/world/routines.ts` is now an adapter, not a
  second implementation: `engine/schedule.ts` owns the five phases, the walk
  back through the day for a missing slot (and forward, when there is nothing
  earlier), and the wrapping shift. Standing and greetings stayed, because
  those are about *this* world knowing *this* rancher.
- **Maze generation** — `renderer/world/maze-map.ts` is one option set with
  three users (the orchard's hedge maze, the Quarry's Deep, the Mesa's
  Brambles).

## Two ports that look obvious and are not

Both of these were on the list. Measured, they are not deletions yet, and
doing them now would add a layer where the plan called for removing one:

- **The wallet and the trade counter.** `core/market.ts` prices specimens and
  picks stock, but the credits are not its to own: they are `wallet: number`
  on `RunStateSnapshot`, part of the parity contract's run state, and moved by
  hand in thirteen places across four modules (`state.ts`, `economy.ts`,
  `renderer.ts`, and the quest rewards in `side-quests.ts`). Rebuilding that on
  `Inventory` + `Shop` means seeding an `Inventory` from a number, writing it
  back after every
  trade, and building a catalog on each render — more code, with the same
  arithmetic in it.

  **Measured, so the next session does not have to re-measure it:** `wallet`
  appears in 79 places across 18 files — `shared/parity-contract.ts` (the
  shared type and its test), `core/economy.ts` (upgrades, supplies),
  `core/market.ts`, `core/population.ts`, `renderer/evolution.worker.ts`,
  `renderer/renderer.ts`, `renderer/state.ts`, `world/side-quests.ts` (reward
  data), both HTML shells, and six test files. The migration and the port
  have to land together, or the tree carries two sources of truth for the
  same number: rename the field to an `Inventory`-shaped `purse` in the run
  state, read `wallet` into it when `purse` is absent (both the localStorage
  path and the desktop file store), and convert the thirteen hand-written
  credit moves to `spend`/`addCoins` in the same change.

  The run-state side — as opposed to the quest reward data, which keeps its
  `wallet?: number` name and is applied in one place — is 43 references in
  seven files: `core/economy.ts:189,196` (upgrade purchase),
  `core/market.ts:104-105` (`canAfford`, whose parameter becomes the purse),
  `core/population.ts:402` (race income), `renderer/evolution.worker.ts:75-76`
  (the worker's own income arithmetic), `renderer/state.ts:387,395,472,484`
  (decor and rename), and `renderer/renderer.ts` (the rest: the market's
  buy/sell, the four wallet readouts, the ranch store's feed and upgrades, and
  the quest payout at 4808). The HTML shells keep their `data-*-wallet`
  attribute names — those are DOM handles, not fields.
- **The herd book.** `Collection` refuses to overfill. The Hall of Fame
  **evicts the oldest entry** when it is full, renames entries, and is
  persisted as a versioned envelope. Adopting the engine's class would mean
  adding eviction and rename to it first — engine API invented for one game's
  storage policy. `heritage.ts` and the Hall of Fame keep their own shape until
  a second game wants the same one.

The migration order matters less than the rule: new gameplay should reach for
the engine first, and each port should delete the duplicate rather than wrap
it.

## The three things left, and what each needs first

Written down because each one was measured and then deliberately not started,
and the next session should not have to re-measure or re-decide:

1. **The wallet and the trade counter.** The plan, the call-site list and the
   lenient-reader requirement are in the section above. It is a save-format
   change: it has to land green in one commit, so it wants a fresh session
   rather than the end of one.
2. **The herd book.** `engine/collection.ts` needs eviction (the Hall of Fame
   drops its oldest entry when full) and rename before it can host the Hall of
   Fame; until then `heritage.ts` keeps its own shape. Small engine addition,
   then a straight port.
3. **A panel of the real app on the engine's scene stack.** This one needs a
   decision before code: vroomon's renderer does not own an engine `Game`, so
   either it grows one (and scenes become a second, parallel world-state) or
   `SceneStack` is lifted out of `Game` as a standalone stack the renderer can
   own on its own. The second is smaller and probably right, but it is a
   design call, not a chore — make it explicitly, in this file, before writing
   the Record Barn list as the first such panel.

## Running the engine tests

```bash
cd active/games/vroomon/electron
npx vitest run tests/engine        # the engine's own suite
npx vitest run tests/engine/engine-game.test.ts   # the demo, played end to end
```
