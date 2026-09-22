/**
 * Hedge Town: a complete game in one file.
 *
 * This is the engine's living documentation and its acceptance test. It has a
 * town with a baker who remembers you, a shop you can buy from, a generated
 * hedge maze with a lost child in it, a hollow with a stranger at the end, and
 * tall grass that can start an encounter. If the engine cannot express this in
 * a few hundred lines of content, it is not usable.
 *
 * Read it top to bottom: tiles, maps, wares, scripts, shops, game. Nothing here
 * knows anything about rendering.
 */

import { type MapDefinition } from "../map.js";
import type { TileDefinition } from "../tiles.js";
import { generateMaze } from "../maze.js";
import type { DialogueScriptDefinition } from "../dialogue.js";
import type { ShopDefinition } from "../shop.js";
import type { ItemDefinition } from "../inventory.js";
import { Game, type EncounterTable, type GameContent } from "../game.js";
import type { Scene, SceneView } from "../scene.js";

/** Tile ids are words; the maps below are drawn with single characters. */
export const HEDGE_TOWN_TILES: TileDefinition[] = [
  { id: "grass", tags: ["floor", "outdoor"] },
  { id: "path", tags: ["floor", "outdoor"] },
  { id: "marsh-grass", encounter: "meadow", tags: ["floor", "outdoor"] },
  { id: "hedge", solid: true, tags: ["wall"] },
  { id: "tree", solid: true, tags: ["wall"] },
  { id: "water", solid: true, tags: ["water"] },
  { id: "boards", tags: ["floor", "indoor"] },
  { id: "counter", solid: true, tags: ["wall", "indoor"] },
  { id: "door", tags: ["floor", "indoor"] },
];

const TILE_CHARS: Record<string, string> = {
  ".": "grass",
  g: "grass",
  "-": "path",
  m: "marsh-grass",
  h: "hedge",
  t: "tree",
  "~": "water",
  b: "boards",
  c: "counter",
  d: "door",
};

/** Draw a map as lines of characters; the ids are resolved here, once. */
function rows(...lines: string[]): string[][] {
  return lines.map((line) =>
    [...line].map((char) => {
      const id = TILE_CHARS[char];
      if (!id) {
        throw new Error(`Hedge Town has no tile for "${char}"`);
      }
      return id;
    }),
  );
}

const town: MapDefinition = {
  id: "town",
  name: "Hedge Town",
  tileset: "hedge-town",
  ambientColor: "#7ba05b",
  // Doors warp you to the tile *beside* the door you came out of, so you can
  // stop falling through: a door you land on is a door you cannot leave.
  tiles: rows(
    "ttttttttttttttt",
    "t............dt",
    "t.mmmm.......dt",
    "t.mmmm........t",
    "t.mmmm........t",
    "t.............t",
    "t....~~~~.....t",
    "t.............t",
    "t.............t",
    "t.......d.....t",
    "ttttttttttttttt",
  ),
  warps: [
    { at: { x: 13, y: 1 }, toMap: "shop", to: { x: 2, y: 4 }, facing: "up" },
    { at: { x: 8, y: 9 }, toMap: "maze", to: { x: 1, y: 2 }, facing: "down" },
  ],
  actors: [
    {
      id: "baker",
      name: "Baker Wren",
      sprite: "baker",
      x: 8,
      y: 3,
      facing: "down",
      dialogue: "baker",
      // Wren bakes before dawn and walks the square in the afternoon.
      routine: {
        stops: {
          dawn: { x: 8, y: 3, facing: "down" },
          afternoon: { x: 5, y: 5, facing: "right" },
          night: null,
        },
      },
    },
    {
      id: "loiterer",
      name: "Old Marrow",
      sprite: "elder",
      x: 3,
      y: 7,
      facing: "up",
      dialogue: "marrow",
    },
  ],
  meta: { region: "grassland" },
};

const shopInterior: MapDefinition = {
  id: "shop",
  name: "The Bakery",
  tileset: "hedge-town",
  interior: true,
  ambientColor: "#2b2018",
  tiles: rows(
    "hhhhhhh",
    "hbbbbbh",
    "hbbbbbh",
    "hbbbbbh",
    "hbbbbbh",
    "hhhhhhh",
  ),
  warps: [{ at: { x: 1, y: 4 }, toMap: "town", to: { x: 12, y: 1 } }],
  actors: [
    {
      id: "counter-hand",
      name: "Pip the Counter Hand",
      sprite: "clerk",
      x: 3,
      y: 2,
      facing: "down",
      dialogue: "counter",
    },
  ],
};

/**
 * The maze is generated, not drawn. `braid` opens a few dead ends so getting
 * lost is a detour rather than a trap, and the entrance is forced open one
 * tile in so there is somewhere to land.
 */
const maze = generateMaze({ width: 17, height: 15, seed: "hedge-maze", braid: 0.15 });
const grassRng = maze.rng.fork("grass");
const mazeTiles: string[][] = maze.rows.map((row, y) =>
  row.map((tile, x) => {
    if (tile === maze.wall) {
      return "hedge";
    }
    if (x === maze.entrance.x && y === maze.entrance.y) {
      return "door";
    }
    return grassRng.bool(0.12) ? "marsh-grass" : "grass";
  }),
);
// Guarantee a landing tile inside the entrance: this tile was a wall or a
// floor depending on the seed, and "somewhere to land" is not a coin flip.
mazeTiles[2]![1] = "grass";
mazeTiles[maze.exit.y]![maze.exit.x] = "grass";

const mazeMap: MapDefinition = {
  id: "maze",
  name: "The Hedge Maze",
  tileset: "hedge-town",
  ambientColor: "#4d6b3a",
  tiles: mazeTiles,
  warps: [
    { at: { x: maze.entrance.x, y: maze.entrance.y }, toMap: "town", to: { x: 8, y: 8 } },
    { at: { x: maze.exit.x, y: maze.exit.y }, toMap: "hollow", to: { x: 2, y: 2 } },
  ],
  actors: [
    {
      id: "hedge-keeper",
      name: "Hedge Keeper Bram",
      sprite: "keeper",
      x: 1,
      y: 3,
      facing: "down",
      dialogue: "keeper",
    },
    {
      // Lost in the middle of the tangle.
      id: "lost-child",
      name: "Tam",
      sprite: "child",
      x: 8,
      y: 7,
      facing: "down",
      dialogue: "tam",
    },
  ],
};

const hollow: MapDefinition = {
  id: "hollow",
  name: "The Hollow",
  tileset: "hedge-town",
  ambientColor: "#3f5a33",
  tiles: rows(
    "hhhhh",
    "h...h",
    "hg..h",
    "h...h",
    "hhhhh",
  ),
  warps: [{ at: { x: 1, y: 2 }, toMap: "town", to: { x: 8, y: 8 } }],
  actors: [
    {
      id: "stranger",
      name: "The Hedger",
      sprite: "hedger",
      x: 3,
      y: 2,
      facing: "left",
      dialogue: "hedger",
    },
  ],
};

export const HEDGE_TOWN_ITEMS: ItemDefinition[] = [
  { id: "bread", name: "Hearth Loaf", description: "Still warm.", value: 2 },
  { id: "pie", name: "Blackberry Pie", description: "Worth the walk.", value: 6 },
  { id: "lantern", name: "Hedge Lantern", description: "Lights the maze at dusk.", value: 12 },
];

const ITEM_NAMES = new Map(HEDGE_TOWN_ITEMS.map((item) => [item.id, item.name]));

/**
 * A real screen over the map, not a test fixture: coins and what is in the bag.
 *
 * It is the demo's proof that the scene stack carries gameplay — the menu key
 * opens it, it swallows the movement keys while it is up so the world behind it
 * holds still, and Escape closes it. A scene describes what it wants drawn and
 * the app draws it; nothing here knows about a canvas.
 */
export function createBagScene(game: Game): Scene {
  return {
    id: "bag",
    view: (): SceneView => ({
      id: "bag",
      title: "Bag",
      rows: [
        { label: "Coins", detail: `${game.coins()} cr` },
        ...game.inventory.items().map(({ item, count }) => ({
          label: ITEM_NAMES.get(item) ?? item,
          detail: `x${count}`,
        })),
      ],
      footer: "Escape to close",
    }),
    input: (action) => {
      if (action === "cancel" || action === "menu") {
        game.popScene();
        return true;
      }
      // A modal scene still has to say it did not use the key; the stack keeps
      // it from reaching the map either way.
      return false;
    },
  };
}

export const HEDGE_TOWN_SHOPS: ShopDefinition[] = [
  {
    id: "bakery",
    name: "The Bakery",
    greeting: "Warm from the oven. What will it be?",
    sellRate: 0.5,
    entries: [
      { item: "bread", price: 3, stock: 6 },
      { item: "pie", price: 9 },
      { item: "lantern", price: 20, stock: 1 },
    ],
  },
];

export const HEDGE_TOWN_ENCOUNTERS: EncounterTable[] = [
  { id: "meadow", chance: 0.5, entries: ["meadow-mouse", "hedge-hare", "clover-beetle"] },
];

export const HEDGE_TOWN_DIALOGUES: DialogueScriptDefinition[] = [
  {
    id: "baker",
    start: "hello",
    nodes: [
      {
        id: "hello",
        text: "Wren wipes her hands on the apron. \"You are the one who has been sleeping in the barn. Sit — what do you need?\"",
        effects: [{ kind: "set-flag", flag: "met-wren" }],
        options: [
          { label: "What is baking?", next: "wares" },
          { label: "Which way to the maze?", next: "directions" },
          { label: "Just passing.", next: null },
        ],
      },
      {
        id: "wares",
        text: "\"Loaves, mostly. Pies when the berries hold out.\"",
        options: [
          {
            label: "Show me the counter.",
            next: null,
            effects: [{ kind: "command", command: "shop", arg: "bakery" }],
          },
          { label: "Some other time.", next: null },
        ],
      },
      {
        id: "directions",
        text: "\"South gate, past the well. Once you are in, keep a hand on the left wall — Bram swears by it.\"",
        next: null,
      },
    ],
  },
  {
    id: "marrow",
    start: "hello",
    nodes: [
      {
        id: "hello",
        text: "Old Marrow does not look up. \"Grass in the hedge is worth walking. Something always lives in it.\"",
        // A first meeting chains into the line he always says; on a later
        // visit this node is skipped and the player lands on that one.
        when: { kind: "not", of: { kind: "flag", flag: "marrow-nodded" } },
        effects: [{ kind: "set-flag", flag: "marrow-nodded" }],
        next: "again",
      },
      {
        id: "again",
        text: "\"Still here. Still not moving.\"",
        options: [
          { label: "Do you ever go home?", next: "home" },
          { label: "Leave him to it.", next: null },
        ],
      },
      {
        id: "home",
        text: "\"I am home. That is the trouble with a bench.\"",
        next: null,
      },
    ],
  },
  {
    id: "counter",
    start: "hello",
    nodes: [
      {
        id: "hello",
        text: "Pip leans on the counter. \"Slow morning. Buy something and I can close early.\"",
        options: [
          {
            label: "Let me see.",
            next: null,
            effects: [{ kind: "command", command: "shop", arg: "bakery" }],
          },
          { label: "Not today.", next: null },
        ],
      },
    ],
  },
  {
    id: "keeper",
    start: "hello",
    nodes: [
      {
        id: "hello",
        text: "Bram tips his hat. \"Left hand on the wall and you will come out somewhere. Tam went in an hour ago and has not come out.\"",
        options: [
          { label: "I will look for them.", next: "thanks" },
          { label: "Why is there a maze at all?", next: "why" },
        ],
      },
      {
        id: "thanks",
        text: "\"Good. There is a lantern in the shop if you are going in at dusk.\"",
        effects: [{ kind: "set-flag", flag: "looking-for-tam" }],
        next: null,
      },
      {
        id: "why",
        text: "\"For the same reason as the hedge: it was here first, and it is good at being here.\"",
        next: null,
      },
    ],
  },
  {
    id: "tam",
    start: "hello",
    nodes: [
      {
        id: "hello",
        text: "Tam is sitting against the hedge with a scratched knee. \"I took the third left. The third left was wrong.\"",
        options: [
          { label: "I will walk you back.", next: "rescued" },
          { label: "Which way did you come?", next: "route" },
        ],
      },
      { id: "route", text: "\"Left. And then not-left. And then I was here.\"", next: null },
      {
        id: "rescued",
        text: "\"You do not have to carry me. I can hop.\"",
        effects: [
          { kind: "set-flag", flag: "tam-rescued" },
          { kind: "command", command: "warp", arg: "town:8:8" },
        ],
        next: null,
      },
    ],
  },
  {
    id: "hedger",
    start: "hello",
    nodes: [
      {
        id: "hello",
        text: "\"You found the middle. Everyone who does gets the same offer: a thing worth two coins, or the way you came.\"",
        options: [
          { label: "The coin, then.", next: null, effects: [{ kind: "coins", amount: 2 }] },
          // A counter, not a flag: he has been counting what you met on the way
          // in, and says so only once there have been a few.
          {
            label: "How many have you seen out here?",
            next: "tally",
            when: { kind: "tally", key: "wild-met", atLeast: 3 },
          },
          { label: "Keep it.", next: null },
        ],
      },
      {
        id: "tally",
        text: "\"Three, since you came in. I count them the way the orchard counts windfalls — the ones left are the ones nobody wanted.\"",
        next: null,
      },
    ],
  },
];

export const HEDGE_TOWN_CONTENT: GameContent = {
  tilesets: [{ id: "hedge-town", tiles: HEDGE_TOWN_TILES }],
  maps: [town, shopInterior, mazeMap, hollow],
  dialogues: HEDGE_TOWN_DIALOGUES,
  shops: HEDGE_TOWN_SHOPS,
  items: HEDGE_TOWN_ITEMS,
  encounters: HEDGE_TOWN_ENCOUNTERS,
  seed: "hedge-town",
  onAction: (action, game) => {
    if (action === "menu") {
      game.pushScene(createBagScene(game));
      return true;
    }
    return false;
  },
};

export function createHedgeTownGame(seed: string | number = "hedge-town"): Game {
  const game = new Game({ ...HEDGE_TOWN_CONTENT, seed });
  // The game's own events keep the counters: the engine has no opinion about
  // what a meeting is worth, only about how to ask for it later.
  game.on("encounter-resolved", () => {
    game.bumpTally("wild-met");
  });
  game.start("town", 3, 8, "right");
  return game;
}

/** The generated maze the demo map was built from, for tests and for looking at. */
export const HEDGE_TOWN_MAZE = maze;
export const HEDGE_TOWN_MAPS = { town, shopInterior, mazeMap, hollow };
