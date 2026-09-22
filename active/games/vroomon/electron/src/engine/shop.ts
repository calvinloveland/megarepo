/**
 * Shops: a stock list, a price, and the arithmetic of buying and selling.
 *
 * The shop owns stock and prices; the inventory owns the bag; the catalog owns
 * only what things *are*. Buy and sell return a result instead of mutating and
 * hoping, so a UI can show "you cannot afford that" without checking twice.
 */

import type { Inventory, ItemCatalog } from "./inventory.js";

export interface ShopEntry {
  item: string;
  price: number;
  /** Absent means unlimited. */
  stock?: number;
}

export interface ShopDefinition {
  id: string;
  name: string;
  greeting?: string;
  entries: readonly ShopEntry[];
  /** Fraction of an item's catalog value paid on a sale. Defaults to 0.5. */
  sellRate?: number;
}

export interface ShopOffer {
  item: string;
  name: string;
  price: number;
  /** null when the shop never runs out. */
  stock: number | null;
  affordable: boolean;
}

export type TradeResult =
  | { ok: true; kind: "buy" | "sell"; item: string; count: number; coins: number }
  | { ok: false; reason: "no-stock" | "no-money" | "no-item" | "not-sellable" };

export interface ShopState {
  remaining: Record<string, number>;
  coins: number;
  items: Record<string, number>;
}

export class Shop {
  private readonly remaining = new Map<string, number>();
  readonly sellRate: number;

  constructor(
    readonly definition: ShopDefinition,
    private readonly inventory: Inventory,
    private readonly catalog: ItemCatalog,
  ) {
    for (const entry of definition.entries) {
      if (entry.stock !== undefined) {
        this.remaining.set(entry.item, entry.stock);
      }
    }
    this.sellRate = definition.sellRate ?? 0.5;
  }

  get id(): string {
    return this.definition.id;
  }

  get name(): string {
    return this.definition.name;
  }

  offers(): ShopOffer[] {
    return this.definition.entries.map((entry) => ({
      item: entry.item,
      name: this.catalog.has(entry.item) ? this.catalog.get(entry.item).name : entry.item,
      price: entry.price,
      stock: entry.stock === undefined ? null : (this.remaining.get(entry.item) ?? 0),
      affordable: this.inventory.coins >= entry.price,
    }));
  }

  buy(item: string, count = 1): TradeResult {
    const entry = this.definition.entries.find((candidate) => candidate.item === item);
    if (!entry) {
      return { ok: false, reason: "no-item" };
    }
    const wanted = Math.max(1, Math.trunc(count));
    if (entry.stock !== undefined) {
      const left = this.remaining.get(item) ?? 0;
      if (left < wanted) {
        return { ok: false, reason: "no-stock" };
      }
    }
    const total = entry.price * wanted;
    if (!this.inventory.spend(total)) {
      return { ok: false, reason: "no-money" };
    }
    this.inventory.add(item, wanted);
    if (entry.stock !== undefined) {
      this.remaining.set(item, (this.remaining.get(item) ?? 0) - wanted);
    }
    return { ok: true, kind: "buy", item, count: wanted, coins: this.inventory.coins };
  }

  sell(item: string, count = 1): TradeResult {
    if (!this.catalog.has(item)) {
      return { ok: false, reason: "not-sellable" };
    }
    const wanted = Math.max(1, Math.trunc(count));
    if (!this.inventory.has(item, wanted)) {
      return { ok: false, reason: "no-item" };
    }
    const price = Math.floor(this.catalog.valueOf(item) * this.sellRate);
    if (price <= 0) {
      return { ok: false, reason: "not-sellable" };
    }
    if (!this.inventory.remove(item, wanted)) {
      return { ok: false, reason: "no-item" };
    }
    this.inventory.addCoins(price * wanted);
    // A bought-back item returns to the shelf, so a shop that stocks it can
    // sell it again.
    const entry = this.definition.entries.find((candidate) => candidate.item === item);
    if (entry?.stock !== undefined) {
      this.remaining.set(item, (this.remaining.get(item) ?? 0) + wanted);
    }
    return { ok: true, kind: "sell", item, count: wanted, coins: this.inventory.coins };
  }

  /** Put the stock back on the shelf (a new day, a new delivery). */
  restock(): void {
    for (const entry of this.definition.entries) {
      if (entry.stock !== undefined) {
        this.remaining.set(entry.item, entry.stock);
      }
    }
  }

  snapshot(): ShopState {
    return {
      remaining: Object.fromEntries(this.remaining),
      coins: this.inventory.coins,
      items: this.inventory.snapshot().items,
    };
  }

  restore(state: Partial<ShopState>): void {
    for (const [item, left] of Object.entries(state.remaining ?? {})) {
      if (this.remaining.has(item)) {
        this.remaining.set(item, left);
      }
    }
    if (typeof state.coins === "number") {
      this.inventory.addCoins(state.coins - this.inventory.coins);
    }
    for (const [item, count] of Object.entries(state.items ?? {})) {
      const have = this.inventory.count(item);
      if (count > have) {
        this.inventory.add(item, count - have);
      } else if (count < have) {
        this.inventory.remove(item, have - count);
      }
    }
  }
}

export function createShopEngine(
  definitions: readonly ShopDefinition[],
): Map<string, ShopDefinition> {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  if (byId.size !== definitions.length) {
    throw new Error("two shops share an id");
  }
  return byId;
}
