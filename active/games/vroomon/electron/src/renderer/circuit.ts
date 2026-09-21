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
 * This ladder rises with the campaign (the Grassland opens the circuit, the
 * Perimeter closes it). What it must NOT do is outrun the ground it sits on:
 * measured over 120 generations of 60 cars, the ceilings are roughly 2,170
 * (Grassland), 3,140 (Sand), 3,200 (Hills), 2,070 (Rocky) and 3,530 (Ice),
 * and every tier V bar below sits under its own terrain's ceiling. At the
 * old growth of 1.28 the Quarry's did not (2,094 against 2,068) — see
 * tests/pacing.test.ts, which enforces the relationship.
 */
const TIER_BASE: Record<string, number> = {
  Flat: 540,
  Grassland: 600,
  Sand: 660,
  Hills: 720,
  Rocky: 780,
  Ice: 840,
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

/** The score to beat at this arena tier. */
export function feudBar(terrainName: string, tier: number): number {
  const base = TIER_BASE[terrainName] ?? TIER_BASE.Grassland!;
  const safeTier = Math.max(1, Math.floor(tier));
  return Math.round(base * Math.pow(TIER_GROWTH, safeTier - 1));
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
