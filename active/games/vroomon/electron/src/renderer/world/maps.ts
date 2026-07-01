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
          text: "Head east on Route 1, walk through the Vroomgrass to capture wild DNA, and challenge Coach Flint at the Grassland Gym. Your Vroomdex will fill as you go.",
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
      "1,0": { mapId: "route_1", toX: 1, toY: 10 },
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
          text: "Oh, you're the new kid! I heard Coach Flint is waiting at the gym. Want to race? My car's been training all morning.",
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
        id: "gym-sign",
        name: "Sign",
        x: 19,
        y: 5,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Grassland Gym — Coach Flint.  'Welcome to the league, kid.'" },
      },
    ],
    encounters: {},
    transitions: {
      "0,5": { mapId: "starter_town", toX: 14, toY: 5 },
      "19,5": { mapId: "gym_1", toX: 6, toY: 9, facing: "up" },
    },
  },
  gym_1: {
    id: "gym_1",
    name: "Grassland Gym",
    width: 14,
    height: 10,
    tiles: GYM_1_TILES,
    ambientColor: "#caa672",
    npcs: [
      {
        id: "coach-flint",
        name: "Coach Flint",
        x: 7,
        y: 4,
        facing: "down",
        sprite: "gym-leader",
        encounterId: "flint-race",
        dialogue: {
          text: "Welcome to the league, kid. I'm Coach Flint. To earn the Grass Badge, you and your car need to beat mine on a real Grassland run.",
          options: [
            { label: "I'm ready to race!", next: "flint-accept" },
            { label: "Not yet, Coach", next: "flint-decline" },
          ],
        },
      },
      {
        id: "flint-accept",
        name: "Coach Flint",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: { text: "On your marks. Set... GO!", onComplete: "gym" },
      },
      {
        id: "flint-decline",
        name: "Coach Flint",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Take your time. Train a few generations in the lab and come back. My car's not going anywhere.",
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
          text: "Sandy Gym — Dr. Dusty.  'Traction is everything out here, kid.'",
        },
      },
    ],
    encounters: {},
    transitions: {
      "0,7": { mapId: "route_1", toX: 18, toY: 6 },
      "21,5": { mapId: "gym_2", toX: 6, toY: 9, facing: "up" },
    },
  },
  gym_2: {
    id: "gym_2",
    name: "Sandy Gym",
    width: 14,
    height: 10,
    tiles: GYM_1_TILES,
    ambientColor: "#c2a670",
    npcs: [
      {
        id: "dr-dusty",
        name: "Dr. Dusty",
        x: 7,
        y: 4,
        facing: "down",
        sprite: "gym-leader",
        encounterId: "dusty-race",
        dialogue: {
          text: "Sand is unforgiving, kid. Six wheels, low pressure, maximum contact patch. That's how I win. Care to try?",
          options: [
            { label: "Bring it on!", next: "dusty-accept" },
            { label: "I need more grip", next: "dusty-decline" },
          ],
        },
      },
      {
        id: "dusty-accept",
        name: "Dr. Dusty",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: { text: "Engage traction control... GO!", onComplete: "gym" },
      },
      {
        id: "dusty-decline",
        name: "Dr. Dusty",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "gym-leader",
        dialogue: {
          text: "Heel-toe the gas in the lab until you find a configuration that grips. Then come back.",
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
