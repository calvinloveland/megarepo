import { describe, expect, it } from "vitest";
import {
  buyPrice,
  canAfford,
  marketStock,
  sellPrice,
  sourceLabel,
} from "../src/core/market.js";
import { seedWildPack } from "../src/core/wild.js";

describe("the trade counter", () => {
  it("prices a specimen by what it can do", () => {
    expect(sellPrice(0)).toBe(5);
    expect(sellPrice(400)).toBe(100);
    expect(sellPrice(1200)).toBe(300);
    // Buying always costs more than selling the same animal: the counter
    // is a business, and trading cannot print credits.
    for (const score of [100, 400, 900, 1600]) {
      expect(buyPrice(score)).toBeGreaterThan(sellPrice(score));
    }
  });

  it("stocks only the ground you have walked", () => {
    expect(marketStock({}).offers).toHaveLength(0);

    const stock = marketStock({ ranch_yard: seedWildPack("ranch_yard") });
    expect(stock.offers.length).toBeGreaterThan(0);
    for (const offer of stock.offers) {
      expect(offer.sourceMapId).toBe("ranch_yard");
      expect(offer.dna.length).toBeGreaterThan(0);
      expect(offer.price).toBeGreaterThanOrEqual(12);
      expect(offer.terrain).toBe("Grassland");
    }
  });

  it("draws from every pack in the save, best first", () => {
    const stock = marketStock(
      {
        ranch_yard: seedWildPack("ranch_yard"),
        ice_map: seedWildPack("ice_map"),
      },
      2,
      6,
    );
    const sources = new Set(stock.offers.map((offer) => offer.sourceMapId));
    expect(sources.size).toBe(2);
    const scores = stock.offers.map((offer) => offer.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("sells better stock as the wild breeds up", () => {
    // A founder pack versus the same pack improved: the counter's prices
    // should follow the animals.
    const founder = marketStock({ ranch_yard: seedWildPack("ranch_yard") }, 3, 6);
    const founderBest = Math.max(...founder.offers.map((offer) => offer.score));
    expect(founder.bestSellPrice).toBeGreaterThan(0);
    expect(founderBest).toBeGreaterThanOrEqual(0);
  });

  it("tells the rancher where the animal came off", () => {
    expect(sourceLabel("ranch_yard")).toBe("the Shoddy Ranch paddock");
    expect(sourceLabel("ice_map")).toBe("the Drift Perimeter");
    expect(sourceLabel("odd_map")).toBe("odd map");
  });

  it("knows what a wallet can carry", () => {
    const offer = { dna: "x", sourceMapId: "ranch_yard", terrain: "Grassland", score: 400, price: buyPrice(400) };
    expect(canAfford(offer.price, offer)).toBe(true);
    expect(canAfford(offer.price - 1, offer)).toBe(false);
  });
});
