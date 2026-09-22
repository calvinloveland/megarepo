import { describe, expect, it } from "vitest";

import { Inventory, createItemCatalog } from "../../src/engine/inventory.js";
import {
  DialogueSession,
  createDialogueScript,
  evaluateCondition,
  type DialogueScriptDefinition,
  type ScriptHost,
} from "../../src/engine/dialogue.js";
import { Shop, createShopEngine, type ShopDefinition } from "../../src/engine/shop.js";

const catalogue = createItemCatalog([
  { id: "bread", name: "Hearth Loaf", value: 2 },
  { id: "lantern", name: "Hedge Lantern", value: 12 },
  { id: "pebble", name: "Pebble", value: 0 },
]);

class TestHost implements ScriptHost {
  readonly flags = new Map<string, boolean>();
  readonly inventory = new Inventory({ coins: 10, items: { pebble: 3 } });
  readonly commands: string[] = [];
  handled: Record<string, (arg: string | undefined) => boolean> = {};

  getFlag(flag: string): boolean {
    return this.flags.get(flag) === true;
  }

  setFlag(flag: string, value: boolean): void {
    this.flags.set(flag, value);
  }

  countItem(item: string): number {
    return this.inventory.count(item);
  }

  coins(): number {
    return this.inventory.coins;
  }

  run(command: string, arg?: string): boolean {
    this.commands.push(arg === undefined ? command : `${command}:${arg}`);
    const handler = this.handled[command];
    if (handler) {
      return handler(arg);
    }
    switch (command) {
      case "give":
        this.inventory.add(arg!.split(":")[0]!, Number(arg!.split(":")[1] ?? 1));
        return true;
      case "take":
        return this.inventory.remove(arg!.split(":")[0]!, Number(arg!.split(":")[1] ?? 1));
      case "coins":
        this.inventory.addCoins(Number(arg ?? 0));
        return true;
      default:
        return false;
    }
  }
}

describe("inventory", () => {
  it("adds, removes and spends without going negative", () => {
    const bag = new Inventory({ coins: 5 });
    expect(bag.add("bread", 2)).toBe(2);
    expect(bag.add("bread")).toBe(3);
    expect(bag.has("bread", 3)).toBe(true);
    expect(bag.remove("bread", 4)).toBe(false);
    expect(bag.count("bread")).toBe(3);
    expect(bag.remove("bread", 2)).toBe(true);
    expect(bag.snapshot()).toEqual({ coins: 5, items: { bread: 1 } });
    expect(bag.spend(10)).toBe(false);
    expect(bag.spend(5)).toBe(true);
    expect(bag.coins).toBe(0);
    expect(bag.addCoins(-4)).toBe(0);
    expect(new Inventory().isEmpty()).toBe(true);
  });

  it("lists items in a stable order and ignores empty counts", () => {
    const bag = new Inventory({ items: { zebra: 1, apple: 2, nothing: 0 } });
    expect(bag.items()).toEqual([
      { item: "apple", count: 2 },
      { item: "zebra", count: 1 },
    ]);
    expect(Inventory.from(bag.snapshot()).items()).toEqual(bag.items());
  });

  it("refuses to name an item it does not know", () => {
    expect(catalogue.has("bread")).toBe(true);
    expect(catalogue.valueOf("lantern")).toBe(12);
    expect(catalogue.ids()).toContain("pebble");
    expect(() => catalogue.get("sword")).toThrow(/no item "sword"/);
  });
});

const script = (nodes: DialogueScriptDefinition["nodes"]): DialogueScriptDefinition => ({
  id: "test",
  start: "start",
  nodes,
});

describe("dialogue", () => {
  it("validates its links up front", () => {
    expect(createDialogueScript(script([{ id: "start", text: "hello" }])).start).toBe("start");
    expect(() => createDialogueScript({ id: "s", start: "missing", nodes: [{ id: "start", text: "hi" }] })).toThrow(
      /missing node "missing"/,
    );
    expect(() =>
      createDialogueScript(script([{ id: "start", text: "hi", next: "gone" }])),
    ).toThrow(/missing node "gone"/);
    expect(() =>
      createDialogueScript(script([{ id: "start", text: "hi", options: [{ label: "go", next: "gone" }] }])),
    ).toThrow(/missing node "gone"/);
    expect(() => createDialogueScript({ id: "e", start: "s", nodes: [] })).toThrow(/no nodes/);
    expect(() =>
      createDialogueScript(script([
        { id: "start", text: "a" },
        { id: "start", text: "b" },
      ])),
    ).toThrow(/twice/);
  });

  it("walks beats, applies node effects on entry, and closes at the end", () => {
    const host = new TestHost();
    const session = new DialogueSession(
      createDialogueScript(
        script([
          {
            id: "start",
            text: "A stranger nods.",
            effects: [{ kind: "set-flag", flag: "met" }],
            next: "second",
          },
          { id: "second", text: "They offer bread.", effects: [{ kind: "give", item: "bread", count: 2 }], next: null },
        ]),
      ),
      host,
    );
    expect(session.current()?.text).toBe("A stranger nods.");
    expect(host.getFlag("met")).toBe(true);
    session.advance();
    expect(session.current()?.text).toBe("They offer bread.");
    expect(host.countItem("bread")).toBe(2);
    session.advance();
    expect(session.isOpen()).toBe(false);
    expect(session.current()).toBeNull();
    expect(session.advance()).toBeUndefined();
  });

  it("never skips a menu the player has not answered", () => {
    const host = new TestHost();
    const session = new DialogueSession(
      createDialogueScript(
        script([
          {
            id: "start",
            text: "Choose.",
            options: [
              { label: "Take coin", next: null, effects: [{ kind: "coins", amount: 4 }] },
              { label: "Take bread", next: null, effects: [{ kind: "give", item: "bread" }] },
            ],
          },
        ]),
      ),
      host,
    );
    session.advance();
    expect(session.isOpen()).toBe(true);
    expect(session.options().map((option) => option.label)).toEqual(["Take coin", "Take bread"]);
    expect(session.choose(9)).toBe(false);
    expect(session.choose(1)).toBe(true);
    expect(host.countItem("bread")).toBe(1);
    expect(host.coins()).toBe(10);
    expect(session.isOpen()).toBe(false);
  });

  it("hides options behind conditions and skips refused nodes", () => {
    const host = new TestHost();
    const session = new DialogueSession(
      createDialogueScript(
        script([
          {
            id: "start",
            text: "A gate.",
            options: [
              { label: "Open it", next: "inside", when: { kind: "flag", flag: "key" } },
              { label: "Walk on", next: null },
            ],
          },
          { id: "inside", text: "Inside.", next: null },
        ]),
      ),
      host,
    );
    expect(session.options().map((option) => option.label)).toEqual(["Walk on"]);
    host.setFlag("key", true);
    expect(session.options().map((option) => option.label)).toEqual(["Open it", "Walk on"]);
  });

  it("lands on the next playable node when a conditional one is refused", () => {
    const host = new TestHost();
    const session = new DialogueSession(
      createDialogueScript(
        script([
          {
            id: "start",
            text: "First time.",
            when: { kind: "flag", flag: "seen", value: false },
            effects: [{ kind: "set-flag", flag: "seen" }],
            next: "common",
          },
          { id: "common", text: "The usual line.", next: null },
        ]),
      ),
      host,
    );
    expect(session.current()?.text).toBe("First time.");
    host.setFlag("seen", true);
    const repeat = new DialogueSession(
      createDialogueScript(
        script([
          {
            id: "start",
            text: "First time.",
            when: { kind: "flag", flag: "seen", value: false },
            next: "common",
          },
          { id: "common", text: "The usual line.", next: null },
        ]),
      ),
      host,
    );
    expect(repeat.current()?.text).toBe("The usual line.");
  });

  it("reports a command nobody handles instead of swallowing it", () => {
    const host = new TestHost();
    const session = new DialogueSession(
      createDialogueScript(
        script([{ id: "start", text: "Do the thing.", effects: [{ kind: "command", command: "fireworks" }] }]),
      ),
      host,
    );
    expect(session.diagnostics).toEqual([
      { scriptId: "test", command: "fireworks", message: 'no handler for command "fireworks"' },
    ]);
    expect(host.commands).toContain("fireworks");
  });

  it("runs the onLeave effects when the beat is acknowledged, and only then", () => {
    const host = new TestHost();
    const build = () =>
      createDialogueScript(
        script([
          {
            id: "start",
            text: "A job offer.",
            effects: [{ kind: "set-flag", flag: "read" }],
            onLeave: [{ kind: "set-flag", flag: "accepted" }],
            options: [{ label: "I'll take it", next: "done" }],
          },
          { id: "done", text: "Good.", onLeave: [{ kind: "coins", amount: 5 }], next: null },
        ]),
      );

    // Shown: the entry effect. Not yet acknowledged: no leave effect.
    const session = new DialogueSession(build(), host);
    expect(host.getFlag("read")).toBe(true);
    expect(host.getFlag("accepted")).toBe(false);

    // Choosing the option acknowledges the beat it was read on.
    expect(session.choose(0)).toBe(true);
    expect(host.getFlag("accepted")).toBe(true);
    expect(host.coins()).toBe(10);

    // ...and advancing past the last beat runs its own leave effects.
    session.advance();
    expect(host.coins()).toBe(15);
    expect(session.isOpen()).toBe(false);

    // A dropped session (Escape) runs nothing: the player did not read it.
    const dropped = new TestHost();
    const abandoned = new DialogueSession(build(), dropped);
    expect(abandoned.isOpen()).toBe(true);
    expect(dropped.getFlag("accepted")).toBe(false);

    // ...and a node skipped by its condition never runs, either way.
    const skipped = new TestHost();
    const skipping = new DialogueSession(
      createDialogueScript(
        script([
          { id: "start", text: "Nothing at all.", when: { kind: "flag", flag: "nope" }, effects: [{ kind: "set-flag", flag: "entered" }], onLeave: [{ kind: "set-flag", flag: "left" }], next: "real" },
          { id: "real", text: "The real beat.", next: null },
        ]),
      ),
      skipped,
    );
    expect(skipping.current()?.text).toBe("The real beat.");
    expect(skipped.getFlag("entered")).toBe(false);
    expect(skipped.getFlag("left")).toBe(false);
  });

  it("evaluates the condition language", () => {
    const host = new TestHost();
    expect(evaluateCondition({ kind: "flag", flag: "x" }, host)).toBe(false);
    host.setFlag("x", true);
    expect(evaluateCondition({ kind: "flag", flag: "x" }, host)).toBe(true);
    expect(evaluateCondition({ kind: "flag", flag: "x", value: false }, host)).toBe(false);
    expect(evaluateCondition({ kind: "item", item: "pebble", count: 2 }, host)).toBe(true);
    expect(evaluateCondition({ kind: "item", item: "pebble", count: 4 }, host)).toBe(false);
    expect(evaluateCondition({ kind: "coins", atLeast: 10 }, host)).toBe(true);
    expect(evaluateCondition({ kind: "coins", atLeast: 11 }, host)).toBe(false);
    expect(
      evaluateCondition(
        { kind: "all", of: [{ kind: "flag", flag: "x" }, { kind: "item", item: "pebble" }] },
        host,
      ),
    ).toBe(true);
    expect(evaluateCondition({ kind: "any", of: [{ kind: "flag", flag: "no" }, { kind: "flag", flag: "x" }] }, host)).toBe(
      true,
    );
    expect(evaluateCondition({ kind: "not", of: { kind: "flag", flag: "no" } }, host)).toBe(true);
  });
});

describe("shop", () => {
  const bakery: ShopDefinition = {
    id: "bakery",
    name: "The Bakery",
    entries: [
      { item: "bread", price: 3, stock: 2 },
      { item: "lantern", price: 20 },
    ],
  };

  it("validates duplicate shop ids", () => {
    expect(createShopEngine([bakery]).get("bakery")).toBe(bakery);
    expect(() => createShopEngine([bakery, bakery])).toThrow(/share an id/);
  });

  it("sells stock, refuses when broke or sold out, and restocks", () => {
    const bag = new Inventory({ coins: 10 });
    const shop = new Shop(bakery, bag, catalogue);
    expect(shop.offers().map((offer) => offer.stock)).toEqual([2, null]);
    expect(shop.buy("sword")).toEqual({ ok: false, reason: "no-item" });
    expect(shop.buy("lantern")).toEqual({ ok: false, reason: "no-money" });

    expect(shop.buy("bread", 2)).toEqual({ ok: true, kind: "buy", item: "bread", count: 2, coins: 4 });
    expect(bag.count("bread")).toBe(2);
    expect(shop.buy("bread")).toEqual({ ok: false, reason: "no-stock" });
    expect(shop.offers()[0]!.stock).toBe(0);
    expect(shop.offers()[0]!.affordable).toBe(true);

    shop.restock();
    expect(shop.offers()[0]!.stock).toBe(2);
  });

  it("buys back at the sell rate and refuses what it cannot value", () => {
    const bag = new Inventory({ coins: 0, items: { bread: 3, pebble: 1 } });
    const shop = new Shop({ ...bakery, sellRate: 0.5 }, bag, catalogue);
    expect(shop.sell("sword")).toEqual({ ok: false, reason: "not-sellable" });
    expect(shop.sell("pebble")).toEqual({ ok: false, reason: "not-sellable" });
    expect(shop.sell("bread", 4)).toEqual({ ok: false, reason: "no-item" });

    expect(shop.sell("bread", 2)).toEqual({ ok: true, kind: "sell", item: "bread", count: 2, coins: 2 });
    expect(bag.count("bread")).toBe(1);
    // A sold lantern would return to the shelf if the shop stocked it.
    shop.restore(shop.snapshot());
    expect(shop.snapshot().coins).toBe(2);
  });
});
