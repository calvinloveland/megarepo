import type { TileKind, Tilemap } from "./types.js";

function row(...cells: TileKind[]): TileKind[] {
  return cells;
}

const STARTER_TOWN_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "building", "building", "building", "building", "building", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "path", "counter", "path", "path", "path", "path", "path", "path", "path", "path", "counter", "path", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "path", "doormat", "path", "path", "path", "path", "path", "path", "path", "path", "doormat", "path", "grass", "tree"),
  row("tree", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "tree"),
  row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "grass", "tree"),
  row("tree", "tree", "grass", "grass", "grass", "tree", "tree", "tree", "tree", "tree", "grass", "grass", "grass", "grass", "tree", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const ROUTE_1_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "rock", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "grass", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "grass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const GYM_1_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall", "wall"),
];

const TILE_TO_X: Record<string, number> = {};

export const MAPS: Record<string, Tilemap> = {
  starter_town: {
    id: "starter_town",
    name: "Starter Town",
    width: 16,
    height: 12,
    tiles: STARTER_TOWN_TILES,
    ambientColor: "#9bc16a",
    npcs: [
      {
        id: "professor-axle",
        name: "Professor Axle",
        x: 4,
        y: 3,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Welcome to the lab, kid! I'm Professor Axle. The Continent of Vroom is full of evolving vehicles. Here, take this starter DNA and a Hall of Fame key.",
          next: "professor-axle-2",
        },
      },
      {
        id: "professor-axle-2",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Head east on Route 1, walk through the Vroomgrass to capture wild DNA, and when you reach the Roundup Grounds, choose your ranch: the Greensprouts' meadow or the Reds' summer circuit. Your Herd Book fills as you go.",
          options: [
            { label: "What is a Vroomdex?", next: "vroomdex-explain" },
            { label: "Got it, thanks!", next: "professor-farewell" },
          ],
        },
      },
      {
        id: "vroomdex-explain",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Every vehicle you encounter leaves a DNA fingerprint in your Vroomdex. Track the wheels, chassis, and powertrains you've seen. The data is precious — every specimen counts.",
          onComplete: "vroomdex",
        },
      },
      {
        id: "professor-farewell",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: { text: "Good luck, kid. The road's waiting." },
      },
      {
        id: "meadow-elder",
        name: "Meadow Elder",
        x: 2,
        y: 9,
        facing: "right",
        sprite: "professor",
        dialogue: {
          text: "Welcome, wanderer. I keep the Greensprout herd at the meadow fence — slow-grown, sturdy, free in the grass. Ride with us and the village grazes you through any winter.",
          options: [
            { label: "Join the Greensprouts", next: "elder-join-faction" },
            { label: "The Reds run faster", next: "elder-decline" },
          ],
        },
      },
      {
        id: "elder-join-faction",
        name: "Meadow Elder",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Then you're one of us. The meadow gate is yours — and the grass always grows back.",
          onComplete: "join-faction:greensprouts",
        },
      },
      {
        id: "elder-decline",
        name: "Meadow Elder",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "The summer circuit calls to many. The Roundup King keeps the west fence — go on, ride.",
        },
      },
      {
        id: "shopkeeper",
        name: "Wrench Wanda",
        x: 11,
        y: 3,
        facing: "left",
        sprite: "mechanic",
        dialogue: {
          text: "First time in town? My shop's quiet today. Come back when you've got a Hall of Fame car or two — I can tune their motors.",
        },
      },
    ],
    encounters: {},
    transitions: {
      // The historical gate was "1,0" — a tree tile, so the town exit was
      // unreachable and the overworld was a dead end.
      "13,2": { mapId: "route_1", toX: 1, toY: 10, facing: "down" },
    },
  },
  route_1: {
    id: "route_1",
    name: "Route 1 — Grasslands Path",
    width: 20,
    height: 14,
    tiles: ROUTE_1_TILES,
    ambientColor: "#a8c879",
    npcs: [
      {
        id: "rival-vicky",
        name: "Rider Vicky",
        x: 18,
        y: 6,
        facing: "left",
        sprite: "rider",
        encounterId: "vicky-race",
        dialogue: {
          text: "Oh, you're the new kid! I heard the Roundup King's Reds are the fastest herd on the plain. Want to race? My car's been training all morning.",
          options: [
            { label: "Let's race!", next: "vicky-accept" },
            { label: "Maybe later", next: "vicky-decline" },
          ],
        },
      },
      {
        id: "vicky-accept",
        name: "Rider Vicky",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Three, two, one... go!", onComplete: "trainer" },
      },
      {
        id: "vicky-decline",
        name: "Rider Vicky",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Bawk! Fine, I'll be here. Don't keep me waiting too long." },
      },
      {
        id: "roundup-sign",
        name: "Sign",
        x: 19,
        y: 5,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Roundup Grounds — Redline Rustlers' summer pasture. The Meadow Elder keeps the far gate in Starter Town." },
      },
    ],
    encounters: {},
    transitions: {
      "0,5": { mapId: "starter_town", toX: 13, toY: 2 },
      // (18,6) was originally the Salt Road gate, but Rider Vicky stands on
      // that tile and blocked it — the gate lives on (18,5) instead.
      "18,5": { mapId: "route_2", toX: 1, toY: 7, facing: "right" },
      "19,5": { mapId: "gym_1", toX: 6, toY: 9, facing: "up" },
    },
  },
  gym_1: {
    id: "gym_1",
    name: "Rustler Pasture",
    width: 14,
    height: 10,
    tiles: GYM_1_TILES,
    ambientColor: "#caa672",
    npcs: [
      {
        id: "roundup-king",
        name: "Roundup King",
        x: 7,
        y: 4,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Welcome to the Roundup Grounds. I'm the Roundup King — my Reds run the summer circuit. Cut the fastest calf, run it at the Roundup, and the circuit pays your keep.",
          options: [
            { label: "Ride for the Reds", next: "king-join-faction" },
            { label: "The Greensprouts suit me", next: "king-decline" },
          ],
        },
      },
      {
        id: "king-join-faction",
        name: "Roundup King",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Then it's settled — you run Red. First rule: the fast ones eat first.",
          onComplete: "join-faction:redlines",
        },
      },
      {
        id: "king-decline",
        name: "Roundup King",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Fair's fair. The Elder's meadow gate is back in town — mention my name and she'll fence you in.",
        },
      },
    ],
    encounters: {},
    transitions: {
      "6,9": { mapId: "route_1", toX: 19, toY: 5 },
      "7,9": { mapId: "route_1", toX: 19, toY: 5 },
    },
  },
  route_2: {
    id: "route_2",
    name: "Route 2 — Sandy Stretch",
    width: 22,
    height: 14,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      row("tree", "vroomgrass", "vroomgrass", "grass", "grass", "rock", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "grass", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "grass", "grass", "path", "path", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "rock", "grass", "path", "path", "grass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "path", "grass", "vroomgrass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "path", "grass", "rock", "grass", "vroomgrass", "grass", "vroomgrass", "vroomgrass", "grass", "vroomgrass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "grass", "rock", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "vroomgrass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "grass", "path", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "path", "grass", "grass", "vroomgrass", "tree"),
      row("tree", "grass", "grass", "grass", "path", "grass", "grass", "grass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "grass", "vroomgrass", "grass", "grass", "path", "vroomgrass", "vroomgrass", "grass", "tree"),
      row("tree", "vroomgrass", "grass", "grass", "path", "rock", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "vroomgrass", "vroomgrass", "grass", "vroomgrass", "path", "grass", "grass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "path", "grass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "vroomgrass", "vroomgrass", "vroomgrass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "vroomgrass", "vroomgrass", "vroomgrass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#d2b67a",
    npcs: [
      {
        id: "rival-marcus",
        name: "Rider Marcus",
        x: 10,
        y: 5,
        facing: "left",
        sprite: "rider",
        encounterId: "marcus-race",
        dialogue: {
          text: "Sand's tricky. My car's got fat wheels for grip. You got fat wheels?",
          options: [
            { label: "Let's find out", next: "marcus-accept" },
            { label: "Maybe next time", next: "marcus-decline" },
          ],
        },
      },
      {
        id: "salt-gate-sign",
        name: "Sign",
        x: 19,
        y: 7,
        facing: "left",
        sprite: "sign",
        dialogue: { text: "Salt Road — dune lanes ahead. The Trail Boss holds the water rights; the Wreck Marshal owns the salvage pits." },
      },
      {
        id: "trail-boss",
        name: "Trail Boss of the Salt Road",
        x: 6,
        y: 12,
        facing: "left",
        sprite: "professor",
        dialogue: {
          text: "Salt Road Caravan. I'm the Trail Boss — we move water and fodder between the oases, together. Ride with us and the road feeds you for life.",
          options: [
            { label: "Join the Salt Road Caravan", next: "trailboss-join-faction" },
            { label: "The wreck camps pay better", next: "trailboss-decline" },
          ],
        },
      },
      {
        id: "trailboss-join-faction",
        name: "Trail Boss of the Salt Road",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Then grab a water skin — the caravan moves at dusk, and the dunes keep what they're given.",
          onComplete: "join-faction:saltcaravan",
        },
      },
      {
        id: "trailboss-decline",
        name: "Trail Boss of the Salt Road",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "The Wreck Marshal keeps the salvage pits at the Salt Road Post. Watch your step over there.",
        },
      },
      {
        id: "highland-herder",
        name: "Highland Herder",
        x: 2,
        y: 9,
        facing: "right",
        sprite: "rider",
        dialogue: {
          text: "The highlands run on two schools: the Guru of the Updrafts breeds windhunters for the updrafts, and the Guru of the Stone Path keeps burrowers in the vents. You'll choose your school when the mesa pass opens.",
        },
      },
      {
        id: "canyon-hauler",
        name: "Canyon Hauler",
        x: 2,
        y: 11,
        facing: "right",
        sprite: "rider",
        dialogue: {
          text: "Down in the canyon, the Lay Foreman runs the Stonecutters' safety boards while the Ringleader books the stunt crews. The contract renegotiation decides who owns the quarries.",
        },
      },
      {
        id: "frost-courier",
        name: "Frost Courier",
        x: 19,
        y: 9,
        facing: "left",
        sprite: "rider",
        dialogue: {
          text: "On the perimeter, the Keeper of the Long Light herds the oldest lineages under the aurora; the Frost Baron moves freight with no receipt. Pack for the cold whichever you answer to.",
        },
      },
      {
        id: "marcus-accept",
        name: "Rider Marcus",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Try to keep up!", onComplete: "trainer" },
      },
      {
        id: "marcus-decline",
        name: "Rider Marcus",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Whatever. Don't blame the sand when you get stuck." },
      },
      {
        id: "sand-sign",
        name: "Sign",
        x: 21,
        y: 5,
        facing: "down",
        sprite: "sign",
        dialogue: {
          text: "Salt Road Post — the Wreck Marshal's fleet holds the water rights out here. Ride the Grasslands first.",
        },
      },
    ],
    encounters: {},
    transitions: {
      "0,7": { mapId: "route_1", toX: 18, toY: 5 },
      "21,5": { mapId: "gym_2", toX: 6, toY: 9, facing: "up" },
    },
  },
  gym_2: {
    id: "gym_2",
    name: "Salt Road Post",
    width: 14,
    height: 10,
    tiles: GYM_1_TILES,
    ambientColor: "#c2a670",
    npcs: [
      {
        id: "wreck-marshal",
        name: "Wreck Marshal",
        x: 7,
        y: 4,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Camp's open. I'm the Wreck Marshal — my Wreckpickers dig salvage genes out of the dune wrecks. Pay's in salvage, and nobody asks where it came from.",
          options: [
            { label: "Join the Wreckpickers", next: "marshal-join-faction" },
            { label: "The caravan suits me", next: "marshal-decline" },
          ],
        },
      },
      {
        id: "marshal-join-faction",
        name: "Wreck Marshal",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Welcome to the salvage pits. First rule: what's buried here stays useful.",
          onComplete: "join-faction:wreckpickers",
        },
      },
      {
        id: "marshal-decline",
        name: "Wreck Marshal",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "The Trail Boss holds the water rights west of the post. Ride safe out there — the dunes don't care who pays you.",
        },
      },
    ],
    encounters: {},
    transitions: {
      "6,9": { mapId: "route_2", toX: 21, toY: 5 },
      "7,9": { mapId: "route_2", toX: 21, toY: 5 },
    },
  },
};

Object.entries(MAPS).forEach(([id, map]) => {
  if (map.transitions[`${TILE_TO_X[id]},0`]) {
    return;
  }
});

export function getMap(mapId: string): Tilemap | undefined {
  return MAPS[mapId];
}

export function isTilePassable(tile: TileKind): boolean {
  return (
    tile === "path" ||
    tile === "grass" ||
    tile === "vroomgrass" ||
    tile === "indoor-floor" ||
    tile === "doormat" ||
    tile === "tall-grass-edge" ||
    tile === "counter" ||
    tile === "rock"
  );
}
