import type { TileKind, Tilemap } from "./types.js";

function row(...cells: TileKind[]): TileKind[] {
  return cells;
}

const STARTER_TOWN_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "doormat", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "building", "building", "building", "path", "building", "grass", "grass", "grass", "grass", "grass", "tree"),
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

// The ranch is TWO spaces: a house you walk around inside, and the yard
// outside it. They are separate maps joined by the porch, so "indoors" is a
// place rather than a corner of one big picture.
const HOME_INTERIOR_TILES: TileKind[][] = [
  row("wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "bed", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "wall"),
  row("wall", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "indoor-floor", "counter", "counter", "indoor-floor", "indoor-floor", "wall"),
  row("wall", "wall", "wall", "wall", "wall", "wall", "doormat", "doormat", "wall", "wall", "wall", "wall", "wall", "wall"),
];

const RANCH_YARD_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "doormat", "doormat", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tall-grass-edge", "tall-grass-edge", "tall-grass-edge", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tall-grass-edge", "tall-grass-edge", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tall-grass-edge", "tall-grass-edge", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "doormat", "doormat", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

const MARROW_ORCHARD_TILES: TileKind[][] = [
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "path", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "fence", "fence", "fence", "fence", "fence", "grass", "grass", "grass", "grass", "path", "grass", "fence", "fence", "fence", "fence", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "water", "water", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "water", "water", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "rock", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "vroomgrass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "fence", "fence", "fence", "fence", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "path", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass", "doormat", "grass", "grass", "grass", "grass", "grass", "grass", "tree"),
  row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
];

export const MAPS: Record<string, Tilemap> = {
  home_ranch: {
    id: "home_ranch",
    name: "The Shoddy Ranch House",
    width: 14,
    height: 5,
    interior: true,
    tiles: HOME_INTERIOR_TILES,
    ambientColor: "#c9a97a",
    npcs: [
      {
        id: "robby-kitchen",
        name: "Rancher Robby",
        x: 7,
        y: 3,
        facing: "left",
        sprite: "professor",
        dialogue: {
          text: "Welcome there, sleepyhead! Ready to start helping around the ranch?",
          options: [
            { label: "Of course — but I didn't see any cattle on the way in?", next: "robby-reveal-1" },
            { label: "For sure! How do I start?", next: "robby-reveal-1" },
          ],
        },
      },
      {
        id: "robby-reveal-1",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Cattle? Ha — nothing so tall on Speid.",
          next: "robby-reveal-2",
        },
      },
      {
        id: "robby-reveal-2",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "My whole herd is vroomon — beetle-sized, mouse-sized, wheeled and wild.",
          next: "robby-reveal-3",
        },
      },
      {
        id: "robby-reveal-3",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "He swings the pasture door wide — and the yard floods with glinting little racers, humming past your ankles.",
          next: "robby-reveal-4",
        },
      },
      {
        id: "robby-reveal-4",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "You stare after them. Wait — those aren't cattle at all. Come on, out to the yard.",
          onComplete: "goto:ranch_yard:7:2:robby-yard-1",
          setFlag: "tut-revealed",
        },
      },
    ],
    encounters: {},
    transitions: {
      // The porch: a doormat in the doorway, straight out to the yard.
      "6,4": { mapId: "ranch_yard", toX: 6, toY: 2, facing: "down" },
      "7,4": { mapId: "ranch_yard", toX: 7, toY: 2, facing: "down" },
    },
  },
  ranch_yard: {
    id: "ranch_yard",
    name: "The Ranch Yard",
    width: 14,
    height: 12,
    tiles: RANCH_YARD_TILES,
    ambientColor: "#a8c879",
    npcs: [
      {
        id: "robby-yard-1",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "This paddock is yours now — a shoddy ranch for a new hand, but ours.",
          next: "robby-yard-2",
        },
      },
      {
        id: "robby-yard-2",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "First lesson. See the tall grass on the left? Wild vroomon graze it. Here — take this one, she's slow but she runs.",
          next: "robby-yard-3",
        },
      },
      {
        id: "robby-yard-3",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Walk to its edge and stand the line. When it shakes, press Z — but a wild one only joins you if you can outrun it.",
          onComplete: "starter-vroomon",
        },
      },
      {
        id: "wild-grass",
        name: "Tall Grass",
        x: 3,
        y: 7,
        facing: "right",
        sprite: "sign",
        dialogue: { text: "The tall grass shivers — something's running under it.", onComplete: "wild" },
      },
      {
        id: "carrier-bench",
        name: "The Carrier Bench",
        x: 6,
        y: 9,
        facing: "left",
        sprite: "mechanic",
        dialogue: {
          text: "Your carrier sits on the bench, herd humming inside. Give it a crank and the paddock opens.",
          onComplete: "open-ranch",
        },
      },
      {
        id: "robby-caught-1",
        name: "Rancher Robby",
        x: 5,
        y: 9,
        facing: "left",
        sprite: "professor",
        dialogue: {
          text: "A wild one on your first morning! Its genome's in your Herd Book now.",
          next: "robby-caught-2",
        },
      },
      {
        id: "robby-caught-2",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "That's how we grow a ranch: catch the wild, breed the best, race your heart out. And here — a pocket carrier, microwave-sized, full of feed. It rides your hip everywhere; the herd rides inside it.",
          next: "robby-caught-3",
        },
      },
      {
        id: "robby-caught-3",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Breeding, now — on the carrier's bench you run a generation and the fastest rise. When the slow ones lag, let them go: the wild takes them back and repays their feed, so culling pays for the next run. Grain tops the bin up if it runs dry.",
          next: "robby-caught-4",
        },
      },
      {
        id: "robby-caught-4",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "See for yourself? The Barn button — bottom-right, 🏟 — holds your Herd Book and the Record Barn.",
          next: "robby-caught-5",
        },
      },
      {
        id: "robby-caught-5",
        name: "Rancher Robby",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Alright, that's all for today! Why don't you go ahead and explore town with the rest of your day?",
          setFlag: "tut-done",
        },
      },
    ],
    encounters: {},
    transitions: {
      // Back inside, and out the garden gate to town.
      "6,1": { mapId: "home_ranch", toX: 6, toY: 4, facing: "up" },
      "7,1": { mapId: "home_ranch", toX: 7, toY: 4, facing: "up" },
      "7,10": { mapId: "starter_town", toX: 8, toY: 5, facing: "up" },
    },
  },

  marrow_orchard: {
    id: "marrow_orchard",
    name: "Marrow Orchard",
    width: 18,
    height: 14,
    tiles: MARROW_ORCHARD_TILES,
    ambientColor: "#9cc46a",
    npcs: [
      {
        id: "keeper-maren",
        name: "Orchard Keeper Maren",
        x: 2,
        y: 11,
        facing: "right",
        sprite: "professor",
        dialogue: {
          text: "Easy there — mind the clover, the whole orchard grazes on it. I keep the old Marrow line: same stock for nine seasons, and I can walk you back along every branch of it. Breeding is patience with a ledger.",
          options: [
            { label: "Show me the family lines", next: "maren-lines" },
            { label: "What would you pay for a champion?", next: "maren-cutting" },
            { label: "What grows out here?", next: "maren-clover" },
          ],
        },
      },
      {
        id: "maren-lines",
        name: "Orchard Keeper Maren",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Carrier's got a Heritage page — every car in your herd book, drawn back to the founders. Tap one and it traces the line it came down. You'll see where a spike came from, and where it went.",
        },
      },
      {
        id: "maren-cutting",
        name: "Orchard Keeper Maren",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Bring me a car that runs 900 on the flat and I'll cut you a Marrow scion — my own line, the good wood.",
          setFlag: "quest-cutting-accepted",
        },
      },
      {
        id: "maren-clover",
        name: "Orchard Keeper Maren",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "Clover for the bees, windfall for the vroomon, and the vroomon for nothing at all. The wild here breeds quicker than the road's — nobody's out here telling them otherwise.",
        },
      },
      {
        id: "picker-sprout",
        name: "Sprout",
        x: 13,
        y: 4,
        facing: "left",
        sprite: "rival",
        dialogue: {
          text: "You're the one off the shoddy ranch! I pick here summers and I race everything that comes up the lane. My car's nothing special — that's the point. Race me and see what yours is worth.",
          options: [
            { label: "Line it up", next: "sprout-race" },
            { label: "Not right now", next: "sprout-later" },
          ],
        },
      },
      {
        id: "sprout-race",
        name: "Sprout",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "Down the lane and past the pond. Ready?",
          onComplete: "trainer",
        },
      },
      {
        id: "sprout-later",
        name: "Sprout",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "Suit yourself. I'll be here, eating windfalls.",
        },
      },
      {
        id: "fitter-aubrey",
        name: "Fitter Aubrey",
        x: 6,
        y: 2,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Maren keeps me on to look at the stock. You can read a vroomon like a ledger, you know — plates for structure, wheels joined at their centres, then the power path running through them. Carrier's got an inspector for it: pick any car and read its blueprint part by part.",
        },
      },
      {
        id: "beekeeper-hollis",
        name: "Beekeeper Hollis",
        x: 15,
        y: 10,
        facing: "left",
        sprite: "villager",
        dialogue: {
          text: "The hives are mine and the clover's theirs. Wild vroomon tear through this end of the orchard flatting the flowers, and my bees won't have it. Thin them out and I'll set you up with skeps.",
          options: [
            { label: "I'll thin the herd", next: "hollis-accept" },
            { label: "About your sister's hives", next: "hollis-run" },
            { label: "Ask someone else", next: "hollis-decline" },
          ],
        },
      },
      {
        id: "hollis-accept",
        name: "Beekeeper Hollis",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Six of them off this clover. Beat them in a race — I don't want them driven off, I want them gone properly.",
          setFlag: "quest-pollination-accepted",
        },
      },
      {
        id: "hollis-run",
        name: "Beekeeper Hollis",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "She keeps hives out on the Drift Perimeter, past the quarry. Walk it and I'll pay the toll myself.",
          setFlag: "quest-pollination-run-accepted",
        },
      },
      {
        id: "hollis-decline",
        name: "Beekeeper Hollis",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "villager",
        dialogue: {
          text: "Then mind your ankles. They bite at the axle grease.",
        },
      },
    ],
    encounters: {},
    transitions: {
      // South down the lane to town, west along the hedge to Route 1.
      "10,12": { mapId: "starter_town", toX: 10, toY: 2, facing: "down" },
      "0,4": { mapId: "route_1", toX: 18, toY: 4, facing: "left" },
      "0,5": { mapId: "route_1", toX: 18, toY: 5, facing: "left" },
    },
  },
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
            { label: "What is a Herd Book?", next: "vroomdex-explain" },
            { label: "How do I breed a champion?", next: "breed-champion-explain" },
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
          text: "Every vehicle you encounter leaves a DNA fingerprint in your Herd Book. Track the wheels, chassis, and powertrains you've seen. The data is precious — every specimen counts.",
          onComplete: "vroomdex",
        },
      },
      {
        id: "breed-champion-explain",
        name: "Professor Axle",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "professor",
        dialogue: {
          text: "It happens in the paddock, not on the road. Your starters sit on the breeding bench: run a generation and the fast ones rise, then save the best to the Record Barn. The Barn tests any car on any terrain, and the records board keeps every lap. A champion is just a name on that board.",
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
        dialogue: { text: "Race a champion, win a Brand, and outrun the road. The meadow's watching, kid.", setFlag: "met-axle" },
      },
      {
        id: "wanda-first-buys",
        name: "Wrench Wanda",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Pasture first — more room, healthier herd. Stalls next, so the Barn holds more champions. And keep a Calm Tonic for the night before a long breeding run; it keeps the genome steady.",
        },
      },
      {
        id: "wanda-bye",
        name: "Wrench Wanda",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: { text: "The yard's always open. Bring credits, bring a car or two." },
      },
      {
        id: "wrangler-jess",
        name: "Wrangler Jess",
        x: 6,
        y: 6,
        facing: "up",
        sprite: "rival",
        dialogue: {
          text: "You're the new hand off the shoddy ranch. Nobody wrangles vroomon without proving they can catch one — beat three of them in a race and I'll believe you.",
          options: [
            { label: "Three races. Easy.", next: "jess-muster" },
            { label: "I'll walk the Mesa road for you", next: "jess-freight" },
            { label: "Not today", next: "jess-brushoff" },
            { label: "Put my name on the board", next: "jess-board" },
          ],
        },
      },
      { id: "jess-board", name: "Wrangler Jess", x: 0, y: 0, facing: "down", sprite: "rival",
        dialogue: { text: "Eight wild ones raced. Do that and I'll chalk your name by the gate myself.", setFlag: "quest-board-accepted" } },
      {
        id: "jess-muster",
        name: "Wrangler Jess",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "Three wild vroomon beaten in honest races. Bring me the count, not the stories.",
          setFlag: "quest-muster-accepted",
        },
      },
      {
        id: "jess-freight",
        name: "Wrangler Jess",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: {
          text: "I've a crate that needs eyes on the Highlands road. Walk the mesa and the fee's yours.",
          setFlag: "quest-freight-accepted",
        },
      },
      {
        id: "jess-brushoff",
        name: "Wrangler Jess",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rival",
        dialogue: { text: "Suit yourself. The grass will still be shaking when you're ready." },
      },
      {
        id: "meadow-elder",
        name: "Meadow Elder",
        x: 2,
        y: 9,
        facing: "right",
        sprite: "professor",
        dialogue: {
          text: "Welcome, wanderer. I keep the Greensprout herd at the meadow fence — slow-grown, sturdy, free in the grass. Run with us and the village grazes you through any winter.",
          options: [
            { label: "Join the Greensprouts", next: "elder-join-faction" },
            { label: "The Reds run faster", next: "elder-decline" },
                      { label: "Race the Rustlers to settle the feud", next: "elder-feud" },
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
        id: "elder-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      {
        id: "shopkeeper",
        name: "Wrench Wanda",
        x: 11,
        y: 3,
        facing: "left",
        sprite: "mechanic",
        dialogue: {
          text: "First time in town? The Ranch fitters' yard is just east of me — wire in pasture for herd room, stalls for barn slots, and a one-shot tonic to calm a nervous breeding night. Every carrier runs on grain: breeding costs a feed a generation, and releasing the slow pays it back. Credits come from every lap the Barn pays out, so race often.",
          options: [
            { label: "What should I buy first?", next: "wanda-first-buys" },
            { label: "I'll be back", next: "wanda-bye" },
          ],
        },
      },
    ],
    encounters: {},
    transitions: {
      // The historical gate was "1,0" — a tree tile, so the town exit was
      // unreachable and the overworld was a dead end.
      "13,2": { mapId: "route_1", toX: 1, toY: 10, facing: "down" },
      "10,0": { mapId: "marrow_orchard", toX: 10, toY: 12, facing: "up" },
      "8,0": { mapId: "ranch_yard", toX: 7, toY: 10, facing: "up" },
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
        id: "oxide-trader",
        name: "Oxide",
        x: 5,
        y: 3,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Oxide. I move stock up and down this road — genomes, grain, the odd gearset. Two things I pay for: samples off the wild, and a herd that actually turns over.",
          options: [
            { label: "I'll bring you samples", next: "oxide-samples" },
            { label: "My herd turns over plenty", next: "oxide-count" },
            { label: "Just passing", next: "oxide-passing" },
          ],
        },
      },
      {
        id: "oxide-samples",
        name: "Oxide",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Four Herd Book samples off the wild. Race them first — I don't buy anything you couldn't catch.",
          setFlag: "quest-samples-accepted",
        },
      },
      {
        id: "oxide-count",
        name: "Oxide",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Then prove it. Five generations on the bench and I'll know you're serious.",
          setFlag: "quest-count-accepted",
        },
      },
      {
        id: "oxide-passing",
        name: "Oxide",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "mechanic",
        dialogue: {
          text: "Everyone's just passing until the feed runs dry. I'll be here.",
        },
      },
      {
        id: "rival-vicky",
        name: "Rider Vicky",
        x: 18,
        y: 6,
        facing: "left",
        sprite: "rider",
        encounterId: "vicky-race",
        dialogue: {
          text: "Oh, you're the new kid! I heard the Roundup King's Reds are the fastest herd on the plain. A race is simple: stand the line and let the machine take the road — one tap of Z and the timer runs. Test any car you've bred in Test Drive first; the flat is a good yardstick, and the records board logs every lap so you can race your own tailwind.",
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
    interior: true,
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
            { label: "Run for the Reds", next: "king-join-faction" },
            { label: "The Greensprouts suit me", next: "king-decline" },
                      { label: "Race the Greensprouts to settle the feud", next: "king-feud" },
            { label: "Run the Grand Roundup", next: "grand-roundup" },
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
      {
        id: "king-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      {
        id: "grand-roundup",
        name: "Grand Roundup",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "rider",
        dialogue: { text: "Five Brands and a champion's names in the Record Barn — then it's three laps against the whole road.", onComplete: "grand-roundup" },
      },
    ],
    encounters: {},
    transitions: {
      "6,9": { mapId: "route_1", toX: 18, toY: 5 },
      "7,9": { mapId: "route_1", toX: 18, toY: 5 },
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
          text: "Salt Road Caravan. I'm the Trail Boss — we move water and fodder between the oases, together. Run with us and the road feeds you for life.",
          options: [
            { label: "Join the Salt Road Caravan", next: "trailboss-join-faction" },
            { label: "The wreck camps pay better", next: "trailboss-decline" },
                      { label: "Race the Wreckpickers to settle the feud", next: "trailboss-feud" },
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
        id: "trailboss-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
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
          text: "Salt Road Post — the Wreck Marshal's fleet holds the water rights out here. Cut your teeth in the Grasslands first.",
        },
      },
    ],
    encounters: {},
    transitions: {
      "0,7": { mapId: "route_1", toX: 18, toY: 5 },
      "19,3": { mapId: "hills_map", toX: 1, toY: 6, facing: "right" },
      "21,5": { mapId: "gym_2", toX: 6, toY: 9, facing: "up" },
    },
  },
  gym_2: {
    id: "gym_2",
    name: "Salt Road Post",
    width: 14,
    height: 10,
    interior: true,
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
                      { label: "Race the Caravan to settle the feud", next: "marshal-feud" },
  { label: "About that wager on the Stretch", next: "wreck-wager" },
],
        },
      },
      { id: "wreck-wager", name: "Wreck Marshal", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "Two wild vroomon beaten out on the Sandy Stretch. Do that and the road's yours to claim.", setFlag: "quest-salt-wager-accepted" } },
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
          text: "The Trail Boss holds the water rights west of the post. Drive safe out there — the dunes don't care who pays you.",
        },
      },
      {
        id: "marshal-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
    ],
    encounters: {},
    transitions: {
      "6,9": { mapId: "route_2", toX: 20, toY: 5 },
      "7,9": { mapId: "route_2", toX: 20, toY: 5 },
    },
  },

  hills_map: {
    id: "hills_map",
    name: "Highland Mesa",
    width: 16,
    height: 12,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      row("tree", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "tree"),
      row("tree", "grass", "rock", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "vroomgrass", "grass", "grass", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "rock", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "rock", "grass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "vroomgrass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "vroomgrass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "vroomgrass", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "vroomgrass", "vroomgrass", "grass", "grass", "grass", "grass", "tree"),
      row("tree", "grass", "rock", "grass", "vroomgrass", "vroomgrass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#a8d2a0",
    npcs: [
      { id: "guru-updrafts", name: "Guru of the Updrafts", x: 5, y: 6, facing: "right", sprite: "professor",
        dialogue: {
          text: "The summit schools are open to you. I teach the light chassis — ride the updrafts, skim the vents. Join the Skimmers and learn the wind lines.",
          options: [
            { label: "Join the Summit Skimmers", next: "skimmers-join-faction" },
            { label: "The stone path calls", next: "skimmers-decline" },
                      { label: "Race the Miners to settle the feud", next: "skimmers-feud" },
  { label: "What do the thermals want?", next: "guru-thermals" },
],
        } },
      { id: "guru-thermals", name: "Guru of the Updrafts", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "Two of the Mesa's wild stock beaten on Mesa ground. The wind keeps the score.", setFlag: "quest-thermals-accepted" } },
      { id: "skimmers-join-faction", name: "Guru of the Updrafts", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "Light as the summit wind, you race now. First lesson: gravity is only a suggestion.", onComplete: "join-faction:skimmers" } },
      { id: "skimmers-decline", name: "Guru of the Updrafts", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "The Stone Path keeps its burrowers warm in the vents. The Guru of the Stone Path waits at the east ridge." } },
      {
        id: "skimmers-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "guru-stone", name: "Guru of the Stone Path", x: 12, y: 6, facing: "left", sprite: "gym-leader",
        dialogue: {
          text: "Below the mesa the vents hum. I breed low-slung burrowers that chew the big hills — steady pay, mineral rights, and a warm tunnel at night. Join the Miners.",
          options: [
            { label: "Join the Hill-Down Miners", next: "miners-join-faction" },
            { label: "The updrafts suit me", next: "miners-decline" },
                      { label: "Race the Skimmers to settle the feud", next: "miners-feud" },
],
        } },
      { id: "miners-join-faction", name: "Guru of the Stone Path", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "Then grab a lamp. First rule: the stone keeps what it gives.", onComplete: "join-faction:miners" } },
      { id: "miners-decline", name: "Guru of the Stone Path", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "The Summit school flies at the west gate. Tell the Guru of the Updrafts I sent you." } },
      {
        id: "miners-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "vent-keeper", name: "Vent Keeper", x: 8, y: 2, facing: "down", sprite: "rider",
        dialogue: { text: "At dusk the mesa vents whistle. Some say the updrafts call their own — city folks just hear wind." } },
    ],
    encounters: {},
    transitions: {
      "1,6": { mapId: "route_2", toX: 18, toY: 3, facing: "left" },
      "14,6": { mapId: "rocky_map", toX: 1, toY: 6, facing: "right" },
    },
  },
  rocky_map: {
    id: "rocky_map",
    name: "Canyon Quarry",
    width: 16,
    height: 12,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      row("tree", "grass", "rock", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "rock", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "rock", "grass", "tree"),
      row("tree", "grass", "grass", "rock", "rock", "grass", "grass", "rock", "rock", "grass", "grass", "rock", "grass", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "rock", "tree"),
      row("tree", "grass", "rock", "path", "grass", "rock", "grass", "rock", "grass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "vroomgrass", "grass", "rock", "tree"),
      row("tree", "grass", "rock", "path", "rock", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "grass", "grass", "rock", "grass", "rock", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "rock", "grass", "tree"),
      row("tree", "rock", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "rock", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#9a9a96",
    npcs: [
      { id: "lay-foreman", name: "The Lay Foreman", x: 5, y: 6, facing: "right", sprite: "gym-leader",
        dialogue: {
          text: "The Union keeps the quarry safe — durable DNA, safety boards, and an hourly wage in credits. Join the Stonecutters and never worry about a busted axle again.",
          options: [
            { label: "Join the Stonecutters' Union", next: "union-join-faction" },
            { label: "I race for the stunts", next: "union-decline" },
                      { label: "Race the Runners to settle the feud", next: "union-feud" },
],
        } },
      { id: "union-join-faction", name: "The Lay Foreman", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "Welcome to the crew. First rule: the safety board signs off before any canyon run.", onComplete: "join-faction:union" } },
      { id: "union-decline", name: "The Lay Foreman", x: 0, y: 0, facing: "down", sprite: "gym-leader",
        dialogue: { text: "The Ringleader books crews at the east rim. Don't sign his waiver without reading it." } },
      {
        id: "union-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "canyon-ringleader", name: "The Ringleader", x: 12, y: 6, facing: "left", sprite: "rider",
        dialogue: {
          text: "Airtime, kid. I book the stunt crews — flare wheels, canyon leaps, and the bookmaker's odds. Run with the Runners and the canyon pays your bets.",
          options: [
            { label: "Join the Canyon Runners", next: "runners-join-faction" },
            { label: "The Union pays steady", next: "runners-decline" },
                      { label: "Race the Union to settle the feud", next: "runners-feud" },
  { label: "What's the work in the Quarry?", next: "canyon-shift" },
],
        } },
      { id: "canyon-shift", name: "The Ringleader", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "Two wild ones beaten in the Quarry. Frames that hold, that's all I'm asking for.", setFlag: "quest-quarry-accepted" } },
      { id: "runners-join-faction", name: "The Ringleader", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "That's the spirit. First rule: land wheels-down, or don't come back.", onComplete: "join-faction:runners" } },
      { id: "runners-decline", name: "The Ringleader", x: 0, y: 0, facing: "down", sprite: "rider",
        dialogue: { text: "The Lay Foreman signs the safe checks at the west gate. Safe is boring, but it pays." } },
      {
        id: "runners-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "assay-clerk", name: "Assay Clerk", x: 5, y: 9, facing: "up", sprite: "mechanic",
        dialogue: { text: "Every picked-over wreck pays double when the canyon's in boom. The Lay Foreman logs it all — the Ringleader doesn't." } },
    ],
    encounters: {},
    transitions: {
      "1,6": { mapId: "hills_map", toX: 14, toY: 6, facing: "left" },
      "14,6": { mapId: "ice_map", toX: 1, toY: 6, facing: "right" },
    },
  },
  ice_map: {
    id: "ice_map",
    name: "Drift Perimeter",
    width: 16,
    height: 12,
    tiles: [
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
      row("tree", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "vroomgrass", "grass", "grass", "grass", "rock", "grass", "tree"),
      row("tree", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "vroomgrass", "grass", "grass", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "vroomgrass", "path", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "grass", "grass", "path", "path", "path", "path", "path", "path", "path", "path", "path", "path", "grass", "grass", "tree"),
      row("tree", "grass", "vroomgrass", "path", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "grass", "vroomgrass", "grass", "grass", "tree"),
      row("tree", "rock", "grass", "path", "rock", "grass", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "rock", "tree"),
      row("tree", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "tree"),
      row("tree", "grass", "rock", "grass", "grass", "grass", "rock", "grass", "grass", "grass", "grass", "grass", "rock", "grass", "grass", "tree"),
      row("tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree", "tree"),
    ],
    ambientColor: "#cfe4f0",
    npcs: [
      { id: "keeper-long-light", name: "Keeper of the Long Light", x: 5, y: 6, facing: "right", sprite: "professor",
        dialogue: {
          text: "The oldest lineages on the ice belong to us. Slow-bred, patient, sure-footed in the drift. Run with the Herdsmen and the aurora keeps your herd.",
          options: [
            { label: "Join the Aurora Herdsmen", next: "herdsmen-join-faction" },
            { label: "The freight lanes pay", next: "herdsmen-decline" },
                      { label: "Race the Syndicate to settle the feud", next: "herdsmen-feud" },
],
        } },
      { id: "herdsmen-join-faction", name: "Keeper of the Long Light", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "Then let the lights find you. First rule: never outrun your herd.", onComplete: "join-faction:herdsmen" } },
      { id: "herdsmen-decline", name: "Keeper of the Long Light", x: 0, y: 0, facing: "down", sprite: "professor",
        dialogue: { text: "The Frost Baron runs the freight lanes along the rim. Ask no questions about the cargo." } },
      {
        id: "herdsmen-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "frost-baron", name: "The Frost Baron", x: 12, y: 6, facing: "left", sprite: "mechanic",
        dialogue: {
          text: "Ice-road freight, no receipt, no refusal. Run with the Syndicate and the lane pays in chits that spend anywhere. The cold doesn't care who you are — neither do I.",
          options: [
            { label: "Join the Drift Syndicate", next: "drift-join-faction" },
            { label: "The Herdsmen keep the lights", next: "drift-decline" },
                      { label: "Race the Herdsmen to settle the feud", next: "drift-feud" },
  { label: "What does the Watch need?", next: "baron-watch" },
],
        } },
      { id: "baron-watch", name: "The Frost Baron", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Two wild vroomon beaten on the ice. The cold breeds them patient, so it's no small ask.", setFlag: "quest-perimeter-accepted" } },
      { id: "drift-join-faction", name: "The Frost Baron", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Welcome to the lane. First rule: the freight goes through, whatever it is.", onComplete: "join-faction:drift-syndicate" } },
      { id: "drift-decline", name: "The Frost Baron", x: 0, y: 0, facing: "down", sprite: "mechanic",
        dialogue: { text: "Then find the Keeper of the Long Light. Slow herds, slow money, warm hearts." } },
      {
        id: "drift-feud",
        name: "Feud Line",
        x: 0,
        y: 0,
        facing: "down",
        sprite: "sign",
        dialogue: { text: "Three, two, one... GO!", onComplete: "gym" },
      },
      { id: "lamp-lighter", name: "Lamp Lighter", x: 8, y: 3, facing: "down", sprite: "rider",
        dialogue: { text: "The long light never quite sets this far north. Mind you don't drift past the lamp line — the Baron's freight don't stop for nobody." } },
    ],
    encounters: {},
    transitions: {
      "1,6": { mapId: "rocky_map", toX: 14, toY: 6, facing: "left" },
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

/**
 * Where a saved position actually belongs now.
 *
 * Maps change: the ranch was split into a house and a yard, so a save made
 * out in the old paddock points outside the house entirely. Rather than
 * dropping the player into the void (or inside a wall), find them somewhere
 * they can stand.
 */
export function safeSpawn(
  mapId: string,
  x: number,
  y: number,
): { mapId: string; x: number; y: number; relocated: boolean } {
  const map = getMap(mapId);
  if (!map) {
    const fallback = getMap("starter_town");
    return { mapId: "starter_town", x: 7, y: 7, relocated: true, ...(fallback ? {} : {}) };
  }

  const standable = (mx: number, my: number): boolean =>
    mx >= 0 &&
    my >= 0 &&
    mx < map.width &&
    my < map.height &&
    isTilePassable(map.tiles[my]?.[mx] ?? "tree");

  if (standable(x, y)) {
    return { mapId, x, y, relocated: false };
  }

  // A pre-split ranch save was out in the paddock: that is the yard now.
  if (mapId === "home_ranch" && (y >= map.height || y > 4)) {
    const yard = getMap("ranch_yard");
    if (yard && isTilePassable(yard.tiles[2]?.[7] ?? "tree")) {
      return { mapId: "ranch_yard", x: 7, y: 2, relocated: true };
    }
  }

  // Otherwise take the closest tile you can stand on.
  let best: { x: number; y: number; distance: number } | null = null;
  const clampX = Math.min(map.width - 1, Math.max(0, x));
  const clampY = Math.min(map.height - 1, Math.max(0, y));
  for (let my = 0; my < map.height; my += 1) {
    for (let mx = 0; mx < map.width; mx += 1) {
      if (!standable(mx, my)) {
        continue;
      }
      const distance = Math.abs(mx - clampX) + Math.abs(my - clampY);
      if (!best || distance < best.distance) {
        best = { x: mx, y: my, distance };
      }
    }
  }

  if (best) {
    return { mapId, x: best.x, y: best.y, relocated: true };
  }
  return { mapId, x: clampX, y: clampY, relocated: true };
}

export function isTilePassable(tile: TileKind): boolean {
  return (
    tile !== "bed" &&
    (tile === "path" ||
      tile === "grass" ||
      tile === "vroomgrass" ||
      tile === "indoor-floor" ||
      tile === "doormat" ||
      tile === "tall-grass-edge" ||
      tile === "counter" ||
      tile === "rock")
  );
}
