// Oxide's trade counter: the road buys and sells stock.
//
// The Herd Book used to be a list you could only add to. A caught wild
// vroomon is worth credits to somebody who has not walked that ground, and a
// genome off a distant pack is worth credits to a rancher whose own line has
// gone stale — so the market is the other half of the wild: it gives the
// specimens you cannot use as breeders a price, and it sells the blood you
// have not been able to reach yet.
//
// Stock is drawn from the WILD PACKS in your save, which means the counter
// only offers ground you have actually walked, and its stock improves as
// those packs evolve on their own. Nothing here is a shortcut past breeding:
// what you buy is a wild animal, its price tracks how good it is, and it
// still has to be bred with.

import { scoreWildPack } from "./wild.js";

export interface MarketOffer {
  dna: string;
  /** Where it came off — the biome whose pack bred it. */
  sourceMapId: string;
  terrain: string;
  score: number;
  price: number;
}

export interface MarketStock {
  offers: MarketOffer[];
  /** The most the counter will pay for a specimen of this quality. */
  bestSellPrice: number;
}

/** Credits paid for a specimen. Wild middling stock is bread, not treasure. */
export function sellPrice(score: number): number {
  return Math.max(5, Math.round(Math.max(0, score) / 4));
}

/** Credits asked for stock. The counter wants double what it pays. */
export function buyPrice(score: number): number {
  return Math.max(12, Math.round(Math.max(0, score) / 2));
}

/** A map's display name for the counter's line, without leaking the id. */
export function sourceLabel(mapId: string): string {
  const names: Record<string, string> = {
    ranch_yard: "the Shoddy Ranch paddock",
    marrow_orchard: "Marrow Orchard",
    route_1: "Route 1",
    route_2: "the Sandy Stretch",
    gym_1: "Rustler Pasture",
    gym_2: "Salt Road Post",
    hills_map: "the Highland Mesa",
    rocky_map: "the Canyon Quarry",
    ice_map: "the Drift Perimeter",
    starter_town: "the town meadow",
  };
  return names[mapId] ?? mapId.replace(/_/g, " ");
}

/**
 * What the counter has on the shelf today, drawn from the packs that live in
 * the save. `perMap` animals come off each pack, best first, priced by what
 * they can actually do.
 */
export function marketStock(
  wildPacks: Record<string, string[]>,
  perMap = 2,
  limit = 6,
): MarketStock {
  const offers: MarketOffer[] = [];

  for (const [mapId, pack] of Object.entries(wildPacks)) {
    if (pack.length === 0) {
      continue;
    }
    const scored = scoreWildPack(mapId, pack);
    // Sample across the pack rather than only its best: the counter sells
    // what it can catch, and a mix reads better than six champions.
    for (let index = 0; index < perMap; index += 1) {
      const member = scored.members[Math.min(scored.members.length - 1, index * 3)];
      if (!member) {
        continue;
      }
      offers.push({
        dna: member.dna,
        sourceMapId: mapId,
        terrain: scored.terrain,
        score: Math.round(member.score),
        price: buyPrice(member.score),
      });
    }
  }

  offers.sort((left, right) => right.score - left.score);
  return {
    offers: offers.slice(0, limit),
    bestSellPrice: sellPrice(
      offers.reduce((best, offer) => Math.max(best, offer.score), 0),
    ),
  };
}

/** Can the rancher afford it? */
export function canAfford(wallet: number, offer: MarketOffer): boolean {
  return wallet >= offer.price;
}
