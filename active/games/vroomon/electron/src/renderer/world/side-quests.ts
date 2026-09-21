// Side quests: the jobs people hand you when you wander their ground.
//
// The main line (see quest.ts) always says what to do next for the campaign.
// These are the detours: a wager at the fair, a wrangler who wants proof, a
// trader who pays in genomes. Every one is a pure function of the world and
// the run, so progress is derived rather than tracked in a dozen places —
// and a save that predates a quest simply reads as "not started".
//
// Accepting one is a dialogue `setFlag` (the same mechanism NPCs already
// use), so adding a quest never needs new dialogue plumbing.

export type QuestObjective =
  | { kind: "catch-wild"; count: number; label: string }
  | { kind: "win-wild"; count: number; label: string }
  /** Beat the wild where it lives: wins counted per biome. */
  | { kind: "win-wild-on"; mapId: string; count: number; label: string }
  /** Specimens in the Herd Book from this many different biomes. */
  | { kind: "dex-biomes"; count: number; label: string }
  /** A champion that reaches this score on a named terrain. */
  | { kind: "champion-on"; terrain: string; score: number; label: string }
  | { kind: "generations"; count: number; label: string }
  | { kind: "decor"; count: number; label: string }
  | { kind: "visit"; mapId: string; label: string }
  | { kind: "brands"; count: number; label: string }
  | { kind: "champion-score"; score: number; label: string }
  | { kind: "release"; count: number; label: string };

export interface QuestReward {
  wallet?: number;
  feed?: number;
  /** A genome planted straight into the herd. */
  dna?: string;
  /** A cosmetic parked in the meadow. */
  decor?: string;
  /** What the giver says when they pay up. */
  thanks: string;
}

export interface SideQuest {
  id: string;
  title: string;
  giver: string;
  mapId: string;
  /**
   * The job that has to be PAID before this one is even offered: the town
   * hands you follow-up work, not a pile of jobs at once.
   */
  requires?: string;
  /** The flag a dialogue node sets to accept this job. */
  acceptFlag: string;
  objective: QuestObjective;
  reward: QuestReward;
  /** What the giver says when offering it. */
  offer: string;
}

/** Everything a quest needs to judge progress. */
export interface QuestWorld {
  badges: string[];
  decor: string[];
  vroomdex: string[];
  currentMapId?: string | null;
  /** flag -> true; quests are accepted through these. */
  flags: Record<string, boolean>;
  /** People and their tallies live here. */
  tally?: Record<string, number>;
  /** dna -> where that specimen came off (see world/specimens.ts). */
  specimenMeta?: Record<string, { mapId: string; score: number; caughtAt: string; origin: "caught" | "bought" }>;
}

export interface QuestRun {
  generation: number;
  populationSize: number;
  bestScore: number;
  released: number;
  /** terrain -> the best the herd has run there (from the records board). */
  bestByTerrain?: Record<string, number>;
}

export interface QuestProgress {
  quest: SideQuest;
  accepted: boolean;
  done: boolean;
  have: number;
  need: number;
  /** "2/3 wild vroomon raced" */
  progressText: string;
}

export const SIDE_QUESTS: SideQuest[] = [
  {
    id: "wranglers-muster",
    title: "The Wrangler's Muster",
    giver: "Wrangler Jess",
    mapId: "starter_town",
    acceptFlag: "quest-muster-accepted",
    objective: { kind: "win-wild", count: 3, label: "raced wild vroomon" },
    reward: { wallet: 120, feed: 3, thanks: "Three races won off the rough. That's a wrangler." },
    offer:
      "Nobody wrangles vroomon without proving they can catch one. Beat three of them in a race and I'll believe you.",
  },
  {
    id: "meadow-fitters",
    title: "Fitters' Errand",
    giver: "Fitter Ollan",
    mapId: "starter_town",
    acceptFlag: "quest-fitters-accepted",
    objective: { kind: "decor", count: 3, label: "pieces placed in the meadow" },
    reward: { wallet: 90, decor: "meadow-sign", thanks: "Three pieces! The meadow's starting to look like a ranch." },
    offer:
      "A ranch with nothing in the yard is just a field. Put three pieces in the meadow and come back a customer.",
  },
  {
    id: "oxide-samples",
    title: "Samples From The Grass",
    giver: "Oxide",
    mapId: "route_1",
    acceptFlag: "quest-samples-accepted",
    objective: { kind: "catch-wild", count: 4, label: "genomes in the Herd Book" },
    reward: {
      wallet: 60,
      dna: "vcG5pzmORWqC",
      thanks: "Four samples. Here — a spare from my own line. It runs true.",
    },
    offer:
      "I buy genomes, not stories. Bring me four Herd Book samples off the wild and I'll pay in stock.",
  },
  {
    id: "long-road-count",
    title: "Counting The Road",
    giver: "Oxide",
    mapId: "route_1",
    acceptFlag: "quest-count-accepted",
    objective: { kind: "generations", count: 5, label: "generations run" },
    reward: { wallet: 140, feed: 4, thanks: "Five generations. Your line's moving. That's worth paying for." },
    offer:
      "A herd that never turns over is a museum. Run five generations and I'll know you're serious.",
  },
  {
    id: "salt-road-wager",
    title: "The Salt Road Wager",
    giver: "Wreck Marshal",
    mapId: "gym_2",
    requires: "wranglers-muster",
    acceptFlag: "quest-salt-wager-accepted",
    objective: { kind: "win-wild-on", mapId: "route_2", count: 2, label: "wild beaten on the Stretch" },
    reward: { wallet: 220, feed: 3, thanks: "Two off the Stretch. The Wreck Marshal pays what he says he pays." },
    offer:
      "Nobody races the Stretch without sand in their teeth. Beat two wild ones out there and I'll call you a road runner.",
  },
  {
    id: "mesa-thermals",
    title: "Thermals And Stone",
    giver: "Guru of the Updrafts",
    mapId: "hills_map",
    requires: "wranglers-muster",
    acceptFlag: "quest-thermals-accepted",
    objective: { kind: "win-wild-on", mapId: "hills_map", count: 2, label: "wild beaten on the Mesa" },
    reward: { wallet: 240, feed: 2, thanks: "The updrafts answer you. Take this for the climb." },
    offer:
      "The Mesa's wild stock climbs better than anything on the flats. Beat two of them on my ground and the school is yours.",
  },
  {
    id: "quarry-shift",
    title: "A Shift In The Quarry",
    giver: "The Ringleader",
    mapId: "rocky_map",
    requires: "wranglers-muster",
    acceptFlag: "quest-quarry-accepted",
    objective: { kind: "win-wild-on", mapId: "rocky_map", count: 2, label: "wild beaten in the Quarry" },
    reward: { wallet: 260, dna: "A9gpwYaIPmdg", thanks: "Rough ground, quick car. Here's a Quarry line to prove it." },
    offer:
      "Nothing survives the Quarry unless its frame holds. Beat two wild ones in here and I'll cut you in.",
  },
  {
    id: "perimeter-watch",
    title: "The Perimeter Watch",
    giver: "The Frost Baron",
    mapId: "ice_map",
    requires: "wranglers-muster",
    acceptFlag: "quest-perimeter-accepted",
    objective: { kind: "win-wild-on", mapId: "ice_map", count: 2, label: "wild beaten on the Perimeter" },
    reward: { wallet: 300, feed: 4, thanks: "Two taken off the ice. The Perimeter remembers its friends." },
    offer:
      "The cold breeds them patient and it breeds them fast. Beat two on my ice and the Watch will vouch for you.",
  },
  {
    id: "town-board",
    title: "A Name On The Board",
    giver: "Wrangler Jess",
    mapId: "starter_town",
    requires: "wranglers-muster",
    acceptFlag: "quest-board-accepted",
    objective: { kind: "win-wild", count: 8, label: "wild vroomon raced" },
    reward: { wallet: 320, feed: 5, thanks: "Eight races won. Your name goes on the board out front." },
    offer:
      "Eight wins and I'll chalk your name on the board by the gate. Nobody argues with the board.",
  },
  {
    id: "switchback-log",
    title: "The Climb, Logged",
    giver: "Cable-hand Juno",
    mapId: "mesa_switchback",
    requires: "town-board",
    acceptFlag: "quest-switchback-accepted",
    objective: { kind: "champion-on", terrain: "Hills", score: 900, label: "on the Mesa" },
    reward: { wallet: 280, feed: 3, thanks: "Nine hundred on the Mesa. Your name and the height, logged." },
    offer:
      "Nine hundred on the Mesa and I'll log the climb — your name and the height, side by side.",
  },
  {
    id: "cut-wager",
    title: "A Thousand On Rock",
    giver: "Face Boss Halg",
    mapId: "the_cut",
    requires: "town-board",
    acceptFlag: "quest-cut-accepted",
    objective: { kind: "champion-on", terrain: "Rocky", score: 1000, label: "in the Quarry" },
    reward: { wallet: 300, dna: "A9gpwYaIPmdg", thanks: "A thousand on rock. Here's a Cut line to go with it." },
    offer:
      "A thousand on this rock, in one run, no favours from the spoil heap.",
  },
  {
    id: "depot-run",
    title: "Smooth On The Ice",
    giver: "Depot Keeper Sable",
    mapId: "long_light_depot",
    requires: "town-board",
    acceptFlag: "quest-depot-accepted",
    objective: { kind: "champion-on", terrain: "Ice", score: 1100, label: "on the Perimeter" },
    reward: { wallet: 320, feed: 4, thanks: "Eleven hundred on the ice. That's a specialist. Here's your load." },
    offer:
      "Eleven hundred on the Drift Perimeter and I'll load your carrier for the road home.",
  },
  {
    id: "roundup-board",
    title: "Brands On The Board",
    giver: "Roundup King",
    mapId: "gym_1",
    requires: "town-board",
    acceptFlag: "quest-brands-accepted",
    objective: { kind: "brands", count: 3, label: "Brands on the board" },
    reward: { wallet: 340, feed: 4, thanks: "Three Brands. The board out front is starting to look like a career." },
    offer:
      "Names on a chalk board mean nothing without Brands behind them. Bring me three and we'll talk about the Roundup.",
  },
  {
    id: "lamps-of-the-mesa",
    title: "The Lamps Of The Mesa",
    giver: "Signal Lorn",
    mapId: "mesa_switchback",
    acceptFlag: "quest-lamps-accepted",
    objective: { kind: "win-wild-on", mapId: "hills_map", count: 2, label: "wild beaten on the Mesa" },
    reward: { wallet: 260, feed: 3, thanks: "Two on the face, past dark. Logged, and paid - I said I would." },
    offer:
      "Two of the Mesa's wild stock beaten on Mesa ground, past dark. I'll log it either way, but I'll pay for it.",
  },
  {
    id: "night-spoil",
    title: "Night On The Spoil",
    giver: "Night Powder Peg",
    mapId: "the_cut",
    acceptFlag: "quest-nightcut-accepted",
    objective: { kind: "win-wild-on", mapId: "rocky_map", count: 2, label: "wild beaten in the Quarry" },
    reward: { wallet: 270, feed: 2, thanks: "Two in the dark on rock. Written in the book, and the book pays." },
    offer:
      "Two wild ones beaten in the Quarry after dark. The heap is quiet then and I hear you coming.",
  },
  {
    id: "late-rows",
    title: "The Late Rows",
    giver: "Night-picker Sib",
    mapId: "marrow_orchard",
    acceptFlag: "quest-late-rows-accepted",
    objective: { kind: "catch-wild", count: 8, label: "genomes off the wild" },
    reward: { wallet: 230, feed: 3, thanks: "Eight off the wild, and the orchard's quieter for it. Take this for the rows." },
    offer:
      "Beat one of the orchard's wild in the dark and I'll believe you've seen what I see.",
  },
  {
    id: "tack-room-finisher",
    title: "A Finisher's Number",
    giver: "Groom Millie",
    mapId: "rustler_tack_room",
    acceptFlag: "quest-tack-accepted",
    objective: { kind: "champion-score", score: 1200, label: "on the flat" },
    reward: { wallet: 240, feed: 3, thanks: "Twelve hundred and it still finishes. I'll tack that up myself." },
    offer:
      "Twelve hundred on the flat and I'll tack it up myself. That's a finisher's number.",
  },
  {
    id: "weighbridge",
    title: "Signed Off At The Scale",
    giver: "Weighmaster Tuck",
    mapId: "salt_post_weighbridge",
    acceptFlag: "quest-weigh-accepted",
    objective: { kind: "win-wild-on", mapId: "route_2", count: 2, label: "wild beaten on the Stretch" },
    reward: { wallet: 250, feed: 2, thanks: "Two off the Stretch. Signed — your freight rate is written down now." },
    offer:
      "Two wild ones beaten on the Stretch and I'll sign your weight off. No signature, no freight rate.",
  },
  {
    id: "freight-ledger",
    title: "A Line That Moves",
    giver: "Clerk Nessa",
    mapId: "salt_road_freight",
    acceptFlag: "quest-ledger-accepted",
    objective: { kind: "generations", count: 10, label: "generations on the bench" },
    reward: { wallet: 260, feed: 3, thanks: "Ten generations. I've written you a rate — the road pays better for stock that moves." },
    offer:
      "Ten generations on the bench. Show me a line that moves and I'll write you a rate for it.",
  },
  {
    id: "night-can",
    title: "The Night Shift",
    giver: "Stoker Vane",
    mapId: "long_light_shed",
    acceptFlag: "quest-shed-accepted",
    objective: { kind: "win-wild-on", mapId: "ice_map", count: 1, label: "wild beaten on the ice" },
    reward: { wallet: 220, feed: 2, thanks: "One off the ice in the dark, can full. You've done a shift." },
    offer:
      "One off the ice, at night, and bring the can back full. That's the shift.",
  },
  {
    id: "nightwatch",
    title: "Work The Dark",
    giver: "Watchman Pell",
    mapId: "long_haul",
    acceptFlag: "quest-nightwatch-accepted",
    objective: { kind: "win-wild-on", mapId: "route_2", count: 2, label: "wild beaten on the Stretch" },
    reward: { wallet: 200, feed: 2, thanks: "Two off the Stretch in the dark. Take the lamp — I've another." },
    offer:
      "Two wild vroomon off the Sandy Stretch after dark. The night pays better than the day.",
  },
  {
    id: "road-walk",
    title: "Word From The Switchback",
    giver: "Storekeep Bram",
    mapId: "town_store",
    acceptFlag: "quest-roadwalk-accepted",
    objective: { kind: "visit", mapId: "mesa_switchback", label: "walk the Switchback" },
    reward: { wallet: 120, feed: 2, thanks: "You walked it. Light cars, is it? I'll price the grease accordingly." },
    offer:
      "Walk the switchback above the Mesa and tell me what the cable hand says about light cars. That's worth paying for.",
  },
  {
    id: "nim-scraps",
    title: "Out Past The Fence",
    giver: "Pot-washer Nim",
    mapId: "long_haul_cookhouse",
    acceptFlag: "quest-scraps-accepted",
    objective: { kind: "release", count: 3, label: "slow vroomon turned out" },
    reward: { wallet: 90, feed: 2, thanks: "Three out past the fence. Sit — that meal's on the house after all." },
    offer:
      "Ada's bench culls what can't run. Three turned out past the fence and I'll get you fed and paid.",
  },
  {
    id: "cogs-bracket",
    title: "Something Worth Welding",
    giver: "Apprentice Cogs",
    mapId: "long_haul_workshop",
    acceptFlag: "quest-bracket-accepted",
    objective: { kind: "champion-score", score: 800, label: "on the flat" },
    reward: { wallet: 80, feed: 1, thanks: "Eight hundred. Hold still — this bracket's going on your carrier." },
    offer:
      "Bring me eight hundred on the flat and I'll weld you a bracket for the carrier. Mine, not Raff's.",
  },
  {
    id: "lane-proof",
    title: "Proof For The Lane",
    giver: "Cook Ada",
    mapId: "long_haul",
    requires: "orchard-cutting",
    acceptFlag: "quest-lane-accepted",
    objective: { kind: "champion-on", terrain: "Sand", score: 1100, label: "on the Stretch" },
    reward: { wallet: 300, feed: 3, thanks: "Eleven hundred on sand. Sit down — the meal's on the house." },
    offer:
      "Bring me eleven hundred out on the Sandy Stretch and I'll believe the lane's worth cooking for.",
  },
  {
    id: "four-grounds",
    title: "Four Grounds",
    giver: "Drover Holt",
    mapId: "long_haul",
    acceptFlag: "quest-book-accepted",
    objective: { kind: "dex-biomes", count: 4, label: "grounds in your Herd Book" },
    reward: { wallet: 260, dna: "Lhn4yi8zKRd2", thanks: "Four grounds. That's a book worth hauling. Take a Long Haul line." },
    offer:
      "Fill that book of yours from four different grounds and I'll pay to see it.",
  },
  {
    id: "orchard-cutting",
    title: "A Marrow Cutting",
    giver: "Orchard Keeper Maren",
    mapId: "marrow_orchard",
    acceptFlag: "quest-cutting-accepted",
    objective: { kind: "champion-score", score: 900, label: "on the flat" },
    reward: {
      wallet: 250,
      dna: "RuAp2owjBaqK",
      thanks: "Nine seasons of Marrow wood, and you've earned a scion of it.",
    },
    offer:
      "Bring me a car that runs 900 on the flat and I'll cut you a Marrow scion — my own line, the good wood.",
  },
  {
    id: "orchard-clover",
    title: "Thin The Clover",
    giver: "Beekeeper Hollis",
    mapId: "marrow_orchard",
    acceptFlag: "quest-pollination-accepted",
    objective: { kind: "catch-wild", count: 6, label: "genomes off the wild" },
    reward: {
      wallet: 110,
      decor: "bee-skeps",
      thanks: "Six off the clover. The bees will forgive you — here, a set of skeps for your meadow.",
    },
    offer:
      "Wild vroomon flat the flowers at this end. Six of them off the clover and I'll set you up with skeps.",
  },
  {
    id: "pollination-run",
    title: "The Long Pollination",
    giver: "Beekeeper Hollis",
    mapId: "marrow_orchard",
    acceptFlag: "quest-pollination-run-accepted",
    objective: { kind: "visit", mapId: "ice_map", label: "walk the Drift Perimeter" },
    reward: { wallet: 180, feed: 3, thanks: "You walked it to the ice and back. That's a beekeeper's errand done." },
    offer:
      "My sister keeps hives out on the Drift Perimeter. Walk that far and I'll pay the toll myself.",
  },
  {
    id: "hill-freight",
    title: "Freight For The Mesa",
    giver: "Wrangler Jess",
    mapId: "starter_town",
    acceptFlag: "quest-freight-accepted",
    objective: { kind: "visit", mapId: "hills_map", label: "walk the Highland Mesa" },
    reward: { wallet: 200, thanks: "You made the Mesa road. That's the long haul done." },
    offer:
      "I've a crate that needs eyes on the Highlands road. Walk it and the fee's yours.",
  },
];

export function findSideQuest(id: string): SideQuest | undefined {
  return SIDE_QUESTS.find((quest) => quest.id === id);
}

function tallyOf(world: QuestWorld, key: string): number {
  return world.tally?.[key] ?? 0;
}

/** How far along an objective is, in its own units. */
export function objectiveProgress(
  objective: QuestObjective,
  world: QuestWorld,
  run: QuestRun,
): number {
  switch (objective.kind) {
    case "catch-wild":
      return world.vroomdex.length;
    case "win-wild":
      return tallyOf(world, "wildWins");
    case "win-wild-on":
      return tallyOf(world, `wildWins:${objective.mapId}`);
    case "dex-biomes":
      return new Set(Object.values(world.specimenMeta ?? {}).map((note) => note.mapId)).size;
    case "champion-on":
      return run.bestByTerrain?.[objective.terrain] ?? 0;
    case "generations":
      return run.generation;
    case "decor":
      return world.decor.length;
    case "visit":
      return tallyOf(world, `visited:${objective.mapId}`) > 0 ? 1 : 0;
    case "brands":
      return world.badges.length;
    case "champion-score":
      return run.bestScore;
    case "release":
      return run.released;
    default:
      return 0;
  }
}

function objectiveNeed(objective: QuestObjective): number {
  switch (objective.kind) {
    case "visit":
      return 1;
    case "champion-score":
    case "champion-on":
      return objective.score;
    default:
      return objective.count;
  }
}

/** A job is only offered once the job it follows has been paid for. */
export function isUnlocked(quest: SideQuest, world: QuestWorld): boolean {
  if (!quest.requires) {
    return true;
  }
  return (world.tally?.[`paid:${quest.requires}`] ?? 0) > 0;
}

export function questProgress(
  quest: SideQuest,
  world: QuestWorld,
  run: QuestRun,
): QuestProgress {
  // A locked job reports as unstarted no matter what flags exist: a save from
  // a build where the chain did not exist cannot have accepted it early.
  const accepted = Boolean(world.flags[quest.acceptFlag]) && isUnlocked(quest, world);
  const have = objectiveProgress(quest.objective, world, run);
  const need = objectiveNeed(quest.objective);
  const done = accepted && have >= need;
  // Champion jobs carry their ground in the label ("on the Mesa"), so a
  // score without it reads as an anonymous number.
  const progressText =
    quest.objective.kind === "champion-score" || quest.objective.kind === "champion-on"
      ? `${Math.round(have)}/${need} pts ${quest.objective.label}`
      : `${Math.min(have, need)}/${need} ${quest.objective.label}`;

  return { quest, accepted, done, have, need, progressText };
}

/**
 * Every quest with its standing, in a stable order: taken jobs first (undone
 * before done), then the ones still waiting to be offered.
 */
export function sideQuestLog(world: QuestWorld, run: QuestRun): QuestProgress[] {
  return SIDE_QUESTS.map((quest) => questProgress(quest, world, run))
    // Locked follow-ups stay off the board until their prerequisite is paid.
    .filter((entry) => entry.accepted || isUnlocked(entry.quest, world))
    .sort((left, right) => {
      const rank = (entry: QuestProgress): number =>
        entry.done ? 2 : entry.accepted ? 0 : 1;
      return rank(left) - rank(right);
    });
}

/** The jobs you have taken and not yet finished — what the HUD nags about. */
export function activeSideQuests(
  world: QuestWorld,
  run: QuestRun,
): QuestProgress[] {
  return sideQuestLog(world, run).filter(
    (entry) => entry.accepted && !entry.done,
  );
}

/**
 * Quests that are finished and not yet paid. The caller applies the reward
 * and records the id in `tally` so a save cannot pay twice.
 */
export function claimableQuests(
  world: QuestWorld,
  run: QuestRun,
): QuestProgress[] {
  return sideQuestLog(world, run).filter(
    (entry) => entry.done && tallyOf(world, `paid:${entry.quest.id}`) === 0,
  );
}
