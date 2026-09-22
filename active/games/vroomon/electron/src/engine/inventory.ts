/**
 * Items and the bag that holds them.
 *
 * Everything a game buys, sells, finds or gives lives here as a string id plus
 * a count. Naming and pricing belong to a catalog, so the same item can be
 * worth 12 at one counter and 40 at another without the inventory knowing.
 */

export interface ItemDefinition {
  id: string;
  name: string;
  description?: string;
  /** Default worth in the game's currency; shops may override. */
  value?: number;
}

export interface InventorySnapshot {
  coins: number;
  items: Record<string, number>;
}

export class Inventory {
  private readonly counts: Map<string, number>;
  private coinCount: number;

  constructor(snapshot?: Partial<InventorySnapshot>) {
    this.counts = new Map<string, number>();
    this.coinCount = snapshot?.coins ?? 0;
    for (const [item, count] of Object.entries(snapshot?.items ?? {})) {
      if (count > 0) {
        this.counts.set(item, count);
      }
    }
  }

  static from(snapshot: Partial<InventorySnapshot> | undefined): Inventory {
    return new Inventory(snapshot);
  }

  get coins(): number {
    return this.coinCount;
  }

  count(item: string): number {
    return this.counts.get(item) ?? 0;
  }

  has(item: string, count = 1): boolean {
    return this.count(item) >= count;
  }

  /** Add items, returning the new total (never negative). */
  add(item: string, count = 1): number {
    if (count <= 0) {
      return this.count(item);
    }
    const total = this.count(item) + count;
    this.counts.set(item, total);
    return total;
  }

  /** Remove items; refuses to go negative, so callers can trust the return. */
  remove(item: string, count = 1): boolean {
    const current = this.count(item);
    if (current < count) {
      return false;
    }
    const left = current - count;
    if (left === 0) {
      this.counts.delete(item);
    } else {
      this.counts.set(item, left);
    }
    return true;
  }

  addCoins(amount: number): number {
    this.coinCount = Math.max(0, this.coinCount + Math.trunc(amount));
    return this.coinCount;
  }

  spend(amount: number): boolean {
    const price = Math.max(0, Math.trunc(amount));
    if (this.coinCount < price) {
      return false;
    }
    this.coinCount -= price;
    return true;
  }

  /** Every held item with a positive count, sorted by id for stable output. */
  items(): { item: string; count: number }[] {
    return [...this.counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([item, count]) => ({ item, count }))
      .sort((left, right) => left.item.localeCompare(right.item));
  }

  isEmpty(): boolean {
    return this.counts.size === 0 && this.coinCount === 0;
  }

  snapshot(): InventorySnapshot {
    return { coins: this.coinCount, items: Object.fromEntries(this.counts) };
  }
}

export interface ItemCatalog {
  has(id: string): boolean;
  get(id: string): ItemDefinition;
  valueOf(id: string): number;
  ids(): string[];
}

export function createItemCatalog(items: readonly ItemDefinition[]): ItemCatalog {
  const byId = new Map(items.map((item) => [item.id, item]));
  const get = (id: string): ItemDefinition => {
    const found = byId.get(id);
    if (!found) {
      throw new Error(`catalog has no item "${id}"`);
    }
    return found;
  };
  return {
    has: (id) => byId.has(id),
    get,
    valueOf: (id) => get(id).value ?? 0,
    ids: () => [...byId.keys()],
  };
}
