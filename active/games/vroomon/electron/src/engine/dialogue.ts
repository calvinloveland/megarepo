/**
 * Dialogue: a graph of nodes, run one beat at a time.
 *
 * A node is what someone says. Options are the branches; conditions hide the
 * branches a player has not earned; effects are what changes in the world.
 * Nothing here knows about a specific game — flags, items and verbs are asked
 * of a `ScriptHost`, which is the game's job to provide. That is the line that
 * keeps conversations authorable as data.
 *
 * Effects fire when a node is *entered*, so the world changes at the same
 * moment the player reads why. A node whose condition is false is skipped
 * without its effects running, which is how "you already have one" branches
 * stay harmless.
 */

export interface ScriptHost {
  getFlag(flag: string): boolean;
  setFlag(flag: string, value: boolean): void;
  countItem(item: string): number;
  coins(): number;
  /**
   * A game-defined verb: "shop:bakery", "warp:town:4:4", "encounter:meadow".
   * Return true when the game handled it, false when the command is unknown —
   * an unknown command is a content bug, and the session reports it rather
   * than swallowing it.
   */
  run(command: string, arg?: string): boolean;
}

export type Condition =
  | { kind: "flag"; flag: string; value?: boolean }
  | { kind: "item"; item: string; count?: number }
  | { kind: "coins"; atLeast: number }
  | { kind: "all"; of: readonly Condition[] }
  | { kind: "any"; of: readonly Condition[] }
  | { kind: "not"; of: Condition };

export type Effect =
  | { kind: "set-flag"; flag: string; value?: boolean }
  | { kind: "give"; item: string; count?: number }
  | { kind: "take"; item: string; count?: number }
  | { kind: "coins"; amount: number }
  | { kind: "command"; command: string; arg?: string };

export interface DialogueOption {
  label: string;
  /** null ends the conversation. */
  next: string | null;
  when?: Condition;
  effects?: readonly Effect[];
}

export interface DialogueNode {
  id: string;
  text: string;
  /** Where advancing goes; null or absent ends the conversation. */
  next?: string | null;
  options?: readonly DialogueOption[];
  /** Only shown/played when this holds. */
  when?: Condition;
  /**
   * Where to go when `when` fails, instead of following `next`. Without it a
   * refused node falls through to `next` — fine for "a first-visit line, then
   * the usual one", wrong for "either this greeting or that one".
   */
  whenFalse?: string | null;
  /** Run when the beat *appears*. */
  effects?: readonly Effect[];
  /**
   * Run when the player *acknowledges* the beat — advancing past it, or
   * picking an option off it — and before the next node is entered. Neither
   * happens when a conversation is simply abandoned (Escape, a scene pushed
   * over it) or when the node was skipped because its `when` failed: nobody
   * read it, so it did not happen.
   *
   * The split matters for content. `effects` is "the world changed while you
   * were looking at this" (a door opening, a light going on); `onLeave` is
   * "you agreed to this" — a quest accepted by the option you chose.
   */
  onLeave?: readonly Effect[];
}

export interface DialogueScriptDefinition {
  id: string;
  start: string;
  nodes: readonly DialogueNode[];
}

export interface DialogueScript {
  readonly id: string;
  readonly start: string;
  readonly nodes: ReadonlyMap<string, DialogueNode>;
}

export function createDialogueScript(definition: DialogueScriptDefinition): DialogueScript {
  const nodes = new Map<string, DialogueNode>();
  for (const node of definition.nodes) {
    if (nodes.has(node.id)) {
      throw new Error(`dialogue "${definition.id}" declares node "${node.id}" twice`);
    }
    nodes.set(node.id, node);
  }
  if (nodes.size === 0) {
    throw new Error(`dialogue "${definition.id}" has no nodes`);
  }
  if (!nodes.has(definition.start)) {
    throw new Error(`dialogue "${definition.id}" starts at missing node "${definition.start}"`);
  }
  for (const node of nodes.values()) {
    const links: Array<[string, string | null | undefined]> = [["next", node.next]];
    for (const option of node.options ?? []) {
      links.push([`option "${option.label}"`, option.next]);
    }
    for (const [label, target] of links) {
      if (target && !nodes.has(target)) {
        throw new Error(`dialogue "${definition.id}": ${node.id} ${label} points at missing node "${target}"`);
      }
    }
  }
  return { id: definition.id, start: definition.start, nodes };
}

export function evaluateCondition(condition: Condition, host: ScriptHost): boolean {
  switch (condition.kind) {
    case "flag":
      return host.getFlag(condition.flag) === (condition.value ?? true);
    case "item":
      return host.countItem(condition.item) >= (condition.count ?? 1);
    case "coins":
      return host.coins() >= condition.atLeast;
    case "all":
      return condition.of.every((inner) => evaluateCondition(inner, host));
    case "any":
      return condition.of.some((inner) => evaluateCondition(inner, host));
    case "not":
      return !evaluateCondition(condition.of, host);
  }
}

export function applyEffect(effect: Effect, host: ScriptHost): boolean {
  switch (effect.kind) {
    case "set-flag":
      host.setFlag(effect.flag, effect.value ?? true);
      return true;
    case "give":
      // The host owns the bag; the engine only says what should happen.
      host.run("give", `${effect.item}:${effect.count ?? 1}`);
      return true;
    case "take":
      host.run("take", `${effect.item}:${effect.count ?? 1}`);
      return true;
    case "coins":
      host.run("coins", String(effect.amount));
      return true;
    case "command":
      return host.run(effect.command, effect.arg);
  }
}

export interface DialogueDiagnostic {
  scriptId: string;
  command: string;
  message: string;
}

/**
 * One run through a conversation. The session is the state a scene holds: which
 * node is on screen, which options are visible, and whether the conversation is
 * still open.
 */
export class DialogueSession {
  /** Commands the host did not recognise, surfaced instead of swallowed. */
  readonly diagnostics: DialogueDiagnostic[] = [];
  private nodeId: string | null;
  private readonly visited = new Set<string>();
  private readonly textOverrides = new Map<string, string>();

  constructor(
    private readonly script: DialogueScript,
    private readonly host: ScriptHost,
  ) {
    this.nodeId = null;
    this.enter(script.start);
  }

  get scriptId(): string {
    return this.script.id;
  }

  /**
   * Substitute a line for this run of the conversation. The game owns the
   * words for a generated beat — a feud briefing, a price quoted back, a name
   * the node could not have known — and the session owns which node is on
   * screen. The override lasts as long as the session does.
   */
  replaceText(nodeId: string, text: string): void {
    this.textOverrides.set(nodeId, text);
  }

  isOpen(): boolean {
    return this.nodeId !== null;
  }

  current(): DialogueNode | null {
    const node = this.nodeId === null ? null : (this.script.nodes.get(this.nodeId) ?? null);
    if (!node) {
      return null;
    }
    const override = this.textOverrides.get(node.id);
    return override === undefined ? node : { ...node, text: override };
  }

  /** The options this player can actually pick right now. */
  options(): DialogueOption[] {
    const node = this.current();
    if (!node?.options) {
      return [];
    }
    return node.options.filter((option) => !option.when || evaluateCondition(option.when, this.host));
  }

  /**
   * Read the next beat. Does nothing while a menu is open — a conversation
   * never skips a choice the player has not made — and runs the node's
   * `onLeave` effects on the way out.
   */
  advance(): void {
    const node = this.current();
    if (!node) {
      return;
    }
    if (this.options().length > 0) {
      return;
    }
    this.runLeave(node);
    this.goto(node.next ?? null);
  }

  /** Pick the `index`-th visible option. Returns false for a stale index. */
  choose(index: number): boolean {
    const option = this.options()[index];
    if (!option) {
      return false;
    }
    const node = this.current();
    if (node) {
      // Leaving the beat comes first: the node the option was read on is the
      // one being acknowledged, then the option's own effects, then whatever
      // the next beat does on entry.
      this.runLeave(node);
    }
    for (const effect of option.effects ?? []) {
      this.apply(effect);
    }
    this.goto(option.next);
    return true;
  }

  private runLeave(node: DialogueNode): void {
    for (const effect of node.onLeave ?? []) {
      this.apply(effect);
    }
  }

  private goto(id: string | null): void {
    if (id === null) {
      this.nodeId = null;
      return;
    }
    this.enter(id);
  }

  /** Enter a node, skipping (and applying nothing for) nodes whose run is refused. */
  private enter(id: string): void {
    let cursor: string | null = id;
    while (cursor !== null) {
      if (this.visited.has(cursor)) {
        // A cycle of condition-skipped nodes would spin forever; stop cleanly.
        this.nodeId = null;
        return;
      }
      this.visited.add(cursor);
      const node = this.script.nodes.get(cursor);
      if (!node) {
        this.nodeId = null;
        return;
      }
      if (node.when && !evaluateCondition(node.when, this.host)) {
        // A refused node has to land somewhere: its own fallback if it has one,
        // otherwise the beat it would have advanced to anyway.
        cursor = node.whenFalse !== undefined ? node.whenFalse : node.next ?? null;
        continue;
      }
      this.nodeId = node.id;
      for (const effect of node.effects ?? []) {
        this.apply(effect);
      }
      return;
    }
    this.nodeId = null;
  }

  private apply(effect: Effect): void {
    if (effect.kind === "command") {
      if (!applyEffect(effect, this.host)) {
        this.diagnostics.push({
          scriptId: this.script.id,
          command: effect.command,
          message: `no handler for command "${effect.command}"`,
        });
      }
      return;
    }
    applyEffect(effect, this.host);
  }
}
