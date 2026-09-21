import { describe, expect, it } from "vitest";
import { OverlayStack, type OverlaySpec } from "../../src/renderer/ui/overlay.js";

/** A spec that records what the stack told it to do. */
function spec(id: string, modal: boolean): OverlaySpec & { visible: boolean; closed: number } {
  const entry = {
    id,
    modal,
    visible: false,
    closed: 0,
    setVisible(visible: boolean) {
      entry.visible = visible;
    },
    onClose() {
      entry.closed += 1;
    },
  };
  return entry;
}

describe("the overlay stack", () => {
  it("keeps one answer for who owns input", () => {
    const stack = new OverlayStack();
    const settings = spec("settings", true);
    const intro = spec("intro", true);
    stack.register(settings);
    stack.register(intro);

    expect(stack.topId()).toBeNull();
    stack.open_("settings");
    expect(stack.topId()).toBe("settings");
    stack.open_("intro");
    expect(stack.topId()).toBe("intro");
    // Closing the top hands input back to the one underneath.
    stack.close("intro");
    expect(stack.topId()).toBe("settings");
    stack.close("settings");
    expect(stack.topId()).toBeNull();
  });

  it("shows and hides exactly once per transition", () => {
    const stack = new OverlayStack();
    const card = spec("card", false);
    stack.register(card);
    expect(card.visible).toBe(false);

    stack.open_("card");
    expect(card.visible).toBe(true);
    // Opening something already open is not a second transition.
    stack.open_("card");
    expect(stack.openIds()).toEqual(["card"]);

    stack.close("card");
    expect(card.visible).toBe(false);
    expect(card.closed).toBe(1);
    // Closing something already closed does nothing, and does not re-run onClose.
    stack.close("card");
    expect(card.closed).toBe(1);
  });

  it("reports a modal only when a modal is up", () => {
    const stack = new OverlayStack();
    stack.register(spec("dpad", false));
    stack.register(spec("race", true));

    stack.open_("dpad");
    expect(stack.modalOpen).toBe(false);
    stack.open_("race");
    expect(stack.modalOpen).toBe(true);
    // A non-modal under a modal does not change the answer.
    stack.close("race");
    expect(stack.modalOpen).toBe(false);
  });

  it("closes the top first, and says whether it closed anything", () => {
    const stack = new OverlayStack();
    stack.register(spec("a", false));
    stack.register(spec("b", true));
    expect(stack.closeTop()).toBe(false);

    stack.open_("a");
    stack.open_("b");
    expect(stack.closeTop()).toBe(true);
    expect(stack.openIds()).toEqual(["a"]);
    expect(stack.closeTop()).toBe(true);
    expect(stack.openIds()).toEqual([]);
    expect(stack.closeTop()).toBe(false);
  });

  it("tells the shell what changed, every time", () => {
    const states: Array<{ modalOpen: boolean; topId: string | null }> = [];
    const stack = new OverlayStack((state) => states.push(state));
    stack.register(spec("race", true));
    stack.open_("race");
    stack.close("race");
    expect(states).toEqual([
      { modalOpen: true, topId: "race" },
      { modalOpen: false, topId: null },
    ]);
  });

  it("ignores an overlay nobody registered", () => {
    const stack = new OverlayStack();
    stack.open_("ghost");
    expect(stack.openIds()).toEqual([]);
    expect(stack.topId()).toBeNull();
  });

  it("starts a late registration hidden, even while others are open", () => {
    const stack = new OverlayStack();
    stack.register(spec("race", true));
    stack.open_("race");

    // Registering a new panel mid-session must not flash it on screen.
    const late = spec("settings", true);
    stack.register(late);
    expect(late.visible).toBe(false);
    expect(stack.topId()).toBe("race");
  });
});
