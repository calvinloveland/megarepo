// The circuit: each feud arena runs a tier. Sweep a tier and the bar rises,
// so the champion who took the Brand meets a track that obsoletes them and
// the player has to breed again. Pure math so it can be unit-tested.

/** Arena map -> the terrain its feud is raced on. */
export const VENUE_TERRAIN: Record<string, string> = {
  gym_1: "Grassland",
  gym_2: "Sand",
  hills_map: "Hills",
  rocky_map: "Rocky",
  ice_map: "Ice",
};

/**
 * Terrain -> the score a champion must beat at tier 1.
 *
 * Each base sits above what a RANDOM 32-car herd already manages on that
 * ground (measured: 750 / 1,145 / 1,097 / 1,052 / 875 on Grassland / Sand /
 * Hills / Rocky / Ice) — because a Brand that falls to the starting
 * population is not a Brand, and a bot clearing all five took six generations
 * at the old bars — and below what a herd reaches even on a poor seed
 * (measured low water marks: 1,271 / 1,673 / 1,519 / 2,068 / 3,239). Between
 * those two bounds the opening circuit is a real ask that is never a wall.
 *
 * The bar is set per terrain because the ground decides what a herd can do:
 * the same car is quick on the Ice and slow on the Grassland. Later tiers are
 * a title defence rather than the campaign's requirement — you need tier I on
 * each biome for its Brand, and the ladder beyond that is for the record
 * books. See tests/pacing.test.ts, which measures the shape.
 */
const TIER_BASE: Record<string, number> = {
  Flat: 1000,
  Grassland: 1000,
  Sand: 1300,
  Hills: 1150,
  Rocky: 1470,
  Ice: 1225,
};

/** How much harder each sweep makes the same ground. */
/**
 * How much harder each sweep gets. Measured against what a herd can actually
 * reach: at 1.28 the Quarry's tier V bar (2094) sat just above the Quarry's
 * own plateau (2068 after 120 generations) — a dead end a player could grind
 * at forever. At 1.22 every terrain's five tiers fit under its ceiling, so the
 * five Brands of a campaign are all winnable.
 */
export const TIER_GROWTH = 1.22;

const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];

export function tierLabel(tier: number): string {
  const safe = Math.max(1, Math.floor(tier));
  return ROMAN[safe - 1] ?? `#${safe}`;
}

export function terrainForVenue(mapId: string): string {
  return VENUE_TERRAIN[mapId] ?? "Grassland";
}

/**
 * The score to beat at this arena tier. A sky can raise it (see
 * `weatherDefence`): the ground asks more of you in the rain, while the score
 * you set in the dry stays where it is. Defaults to clear, so every other
 * caller — and every measurement in the suite — is unchanged.
 */
export function feudBar(terrainName: string, tier: number, defence = 1): number {
  const base = TIER_BASE[terrainName] ?? TIER_BASE.Grassland!;
  const safeTier = Math.max(1, Math.floor(tier));
  return Math.round(base * Math.pow(TIER_GROWTH, safeTier - 1) * defence);
}

export function nextTier(tier: number): number {
  return Math.max(1, Math.floor(tier)) + 1;
}

export interface TierOutcome {
  won: boolean;
  shortfall: number;
}

/** Did the champion clear the bar? */
export function tierOutcome(championScore: number, bar: number): TierOutcome {
  const score = Number.isFinite(championScore) ? championScore : 0;
  return {
    won: score >= bar,
    shortfall: Math.max(0, Math.round(bar - score)),
  };
}

/** The rival runs just under the bar — beating the bar beats them. */
export function rivalScoreFor(bar: number): number {
  return Math.round(bar * 0.94);
}

/** Rank-style flavour for a tier: "Salt Road II". */
export function venueTitle(venueName: string, tier: number): string {
  return `${venueName} ${tierLabel(tier)}`;
}


/** Map -> the Brand a feud won there earns. The single source of truth for
 * both the controller's badge awards and the circuit's tier keys. */
export const BADGE_BY_MAP: Record<string, string> = {
  starter_town: "Grassland Brand",
  gym_1: "Grassland Brand",
  route_2: "Salt Road Brand",
  gym_2: "Salt Road Brand",
  hills_map: "Highland Brand",
  rocky_map: "Canyon Brand",
  ice_map: "Perimeter Brand",
};

/** The arena map that owns each circuit (the tier is keyed by Brand, so a
 * sweep raises the bar everywhere that Brand is raced). */
export const VENUE_BADGE: Record<string, string> = {
  gym_1: "Grassland Brand",
  gym_2: "Salt Road Brand",
  hills_map: "Highland Brand",
  rocky_map: "Canyon Brand",
  ice_map: "Perimeter Brand",
};

export function badgeForMap(mapId: string): string {
  return BADGE_BY_MAP[mapId] ?? "Grassland Brand";
}

/** The order the road takes you through the arenas. */
export const VENUE_ORDER = ["gym_1", "gym_2", "hills_map", "rocky_map", "ice_map"];

export interface CircuitTarget {
  mapId: string;
  terrain: string;
  tier: number;
  bar: number;
}

/**
 * Which arena the rancher should be breeding for: the one they're standing
 * in, else the next one whose Brand they haven't taken.
 */
export function nextCircuitTarget(
  currentMapId: string,
  badges: string[],
  feudTiers: Record<string, number> | undefined,
): CircuitTarget {
  const here = VENUE_ORDER.includes(currentMapId) ? currentMapId : null;
  const unswept = VENUE_ORDER.find(
    (mapId) => !badges.includes(VENUE_BADGE[mapId] ?? ""),
  );
  const mapId = here ?? unswept ?? VENUE_ORDER[0]!;
  const terrain = terrainForVenue(mapId);
  const tier = Math.max(1, feudTiers?.[badgeForMap(mapId)] ?? 1);
  return { mapId, terrain, tier, bar: feudBar(terrain, tier) };
}


/**
 * What the ground asks of you, said out loud before you race it. The circuit
 * is a breeding target, not a scoreboard — and a player who has never been
 * told that the bar is 1000 while their barn holds 973 has no way to work out
 * that the answer is generations, not a different car.
 */
export function feudBriefing(options: {
  terrain: string;
  tier: number;
  bar: number;
  best: number;
  /** The car that would answer it, when there is one. */
  shape?: VehicleShape | null;
}): string {
  const { terrain, tier, bar, best, shape } = options;
  const label = `${terrain} ${tierLabel(tier)}`;
  const demand = shapeForTier(tier);
  const shapeNote = tier > 1 ? ` It also wants ${demand.wants}.` : "";
  const shapeFail = shape ? shapeShortfall(shape, tier) : null;
  if (shapeFail) {
    return `${label}. ${shapeFail}${tier > 1 ? "" : ""} Breed a car that fits the ground.`;
  }
  const asked = `The bar is ${Math.round(bar)}`;
  if (best <= 0) {
    return `${label}. ${asked}, and there is nothing in your Record Barn to answer it. Breed one first.${shapeNote}`;
  }
  const held = `your barn holds ${Math.round(best)}`;
  if (best >= bar) {
    return `${label}. ${asked} and ${held}. This one is yours to lose.${shapeNote}`;
  }
  const short = Math.round(bar - best);
  return (
    `${label}. ${asked}; ${held} — ${short} short. ` +
    `That is a breeding job, not a racing one.${shapeNote}`
  );
}


// ---------------------------------------------------------------------------
// What the ground asks of the car, beyond its time
// ---------------------------------------------------------------------------

/** The structural facts a tier can be judged on. */
export interface VehicleShape {
  plates: number;
  wheels: number;
  engines: number;
  drivenWheels: number;
}

export interface TierShape {
  /** What this tier wants, in the player's words. */
  text: string;
  meets: (shape: VehicleShape) => boolean;
  /** The same thing as a requirement, for a failure line. */
  wants: string;
}

/**
 * A score bar alone rewards hunting: one lucky animal off the ground can clear
 * two tiers at once (measured: a single wild import took a herd from tier I to
 * tier III in one generation). From tier II the ground also asks what your car
 * is *made of*, so the climb rewards breeding a shape as well as finding a
 * number. Tier I asks nothing: that Brand is the lesson.
 */
export const TIER_SHAPE: Record<number, TierShape> = {
  1: {
    text: "any car that rolls",
    wants: "any car that rolls",
    meets: () => true,
  },
  2: {
    text: "two driven wheels",
    wants: "at least two driven wheels",
    meets: (shape) => shape.drivenWheels >= 2,
  },
  3: {
    text: "three wheels, two of them driven",
    wants: "at least three wheels, two of them driven",
    meets: (shape) => shape.wheels >= 3 && shape.drivenWheels >= 2,
  },
  4: {
    text: "four wheels, three of them driven",
    wants: "at least four wheels, three of them driven",
    meets: (shape) => shape.wheels >= 4 && shape.drivenWheels >= 3,
  },
  5: {
    text: "four driven wheels behind three engines",
    wants: "at least four driven wheels and three engines",
    meets: (shape) => shape.drivenWheels >= 4 && shape.engines >= 3,
  },
};

export function shapeForTier(tier: number): TierShape {
  return TIER_SHAPE[Math.min(5, Math.max(1, Math.floor(tier)))] ?? TIER_SHAPE[1]!;
}

/**
 * Why this car cannot answer this tier, or null when its shape is fine. Said
 * as a sentence so the feud can hand it straight to the player.
 */
export function shapeShortfall(shape: VehicleShape, tier: number): string | null {
  const demand = shapeForTier(tier);
  if (demand.meets(shape)) {
    return null;
  }
  // "The ground wants…" rather than naming the tier again: this line is
  // printed right after "Grassland II.", and reads oddly doubled up.
  return (
    `The ground wants ${demand.wants}; this one has ` +
    `${shape.wheels} wheel${shape.wheels === 1 ? "" : "s"}, ` +
    `${shape.drivenWheels} driven, ${shape.engines} engine${shape.engines === 1 ? "" : "s"}.`
  );
}


/**
 * The shape demand of a tier, read against one car — the line the Inspector
 * shows so a player can see whether the animal in front of them would answer
 * the ground they are about to race, before they walk to the arena.
 */
export function shapeReadout(shape: VehicleShape, tier: number): string {
  const shortfall = shapeShortfall(shape, tier);
  if (shortfall) {
    return shortfall;
  }
  const demand = shapeForTier(tier);
  if (tier <= 1) {
    return "Tier I asks nothing of the build — any car that rolls can answer it.";
  }
  return `This car fits the ground: ${demand.wants}, and it has ${shape.drivenWheels} driven.`;
}
