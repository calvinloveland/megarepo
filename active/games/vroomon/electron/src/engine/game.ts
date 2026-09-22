/**
 * The game: content in, a walkable world out.
 *
 * This is the piece that ties the engine together. It owns the maps, the
 * player, the day, the bag, the herd book and the stack of open scenes; it
 * answers the script host's questions (flags, items, coins) and runs the verbs
 * a conversation can ask for. A renderer talks to `view()` and to nothing else,
 * which is what keeps drawing code out of gameplay code.
 */

import type { Cell } from "./grid.js";
import { tileKey } from "./grid.js";
import type { Facing } from "./direction.js";
import { facingVector } from "./direction.js";
import {
  advanceActors,
  actorPixel,
  beginStep,
  createActorState,
  facingTile,
  isStepping,
  turnTo,
  type ActorState,
} from "./actors.js";
import { cameraForActor, type CameraState, type Size } from "./camera.js";
import {
  defineMap,
  isSolidTile,
  validateMapGraph,
  warpAt,
  type GameMap,
  type MapDefinition,
} from "./map.js";
import { createTileSet, type TileSet } from "./tiles.js";
import { DAY_PHASES, phaseName, resolveRoutine, type DayPhase } from "./schedule.js";
import {
  DialogueSession,
  createDialogueScript,
  type DialogueScript,
  type DialogueScriptDefinition,
  type ScriptHost,
} from "./dialogue.js";
import { Inventory, createItemCatalog, type InventorySnapshot, type ItemCatalog, type ItemDefinition } from "./inventory.js";
import { Shop, type ShopDefinition, type ShopOffer, type ShopState, type TradeResult } from "./shop.js";
import type { Specimen } from "./collection.js";
import { createRng, type Rng } from "./rng.js";
import { createSaveRegistry, decodeSave, encodeSave, type SaveRegistry } from "./save.js";
import { SceneStack, type Scene, type SceneView } from "./scene.js";
import type { GameAction } from "./input.js";

export interface EncounterTable {
  id: string;
  /** Chance per step onto an encounter tile. Defaults to 1. */
  chance?: number;
  entries: readonly string[];
}

export interface GameContent {
  tilesets: readonly { id: string; tiles: Parameters<typeof createTileSet>[1] }[];
  maps: readonly MapDefinition[];
  dialogues?: readonly DialogueScriptDefinition[];
  shops?: readonly ShopDefinition[];
  items?: readonly ItemDefinition[];
  encounters?: readonly EncounterTable[];
  /** Game-defined dialogue verbs. Return false when the command is unknown. */
  commands?: Record<string, (arg: string | undefined, game: Game) => boolean>;
  /**
   * Actions nothing else wanted — a menu key, a map key. Return true when the
   * game handled it. This is how a game opens its own scenes.
   */
  onAction?: (action: GameAction, game: Game) => boolean;
  seed?: string | number;
  stepMs?: number;
  tileSize?: number;
  /** Real milliseconds in one in-game day. Defaults to 24 minutes. */
  dayLengthMs?: number;
}

export type GameEvent =
  | { type: "warp"; from: string; to: string; x: number; y: number }
  | { type: "encounter"; table: string; entry: string; mapId: string }
  | { type: "encounter-resolved"; table: string }
  | { type: "flag"; flag: string; value: boolean }
  | { type: "item"; item: string; count: number }
  | { type: "coins"; coins: number }
  | { type: "dialogue"; scriptId: string | null }
  | { type: "shop"; shopId: string | null }
  | { type: "command"; command: string; arg: string | undefined };

export interface GameViewActor {
  id: string;
  kind: "player" | "npc";
  sprite: string;
  name: string | null;
  x: number;
  y: number;
  facing: Facing;
  pixel: { x: number; y: number };
  stepping: boolean;
  dialogue: string | null;
}

export interface GameView {
  map: GameMap;
  camera: CameraState;
  tileSize: number;
  actors: GameViewActor[];
  dialogue: { scriptId: string; speaker: string | null; text: string; options: string[] } | null;
  shop: { id: string; name: string; offers: ShopOffer[]; coins: number } | null;
  encounter: { table: string; entry: string } | null;
  sceneId: string | null;
  /** The top scene's own panel description, when it has one. */
  scene: SceneView | null;
  clock: { ms: number; fraction: number; phase: DayPhase };
}

export interface GameSnapshot {
  seed: number;
  mapId: string;
  x: number;
  y: number;
  facing: Facing;
  clockMs: number;
  flags: Record<string, boolean>;
  inventory: InventorySnapshot;
  collection: Specimen[];
  shops: Record<string, ShopState>;
  extra: Record<string, unknown>;
}

export const GAME_SAVE_VERSION = 1;

export function createGameSaveRegistry(
  migrations: Record<number, (data: unknown) => unknown> = {},
): SaveRegistry {
  return createSaveRegistry(GAME_SAVE_VERSION, migrations);
}

interface ResolvedContent {
  tilesets: Map<string, TileSet>;
  maps: Map<string, GameMap>;
  dialogues: Map<string, DialogueScript>;
  shops: Map<string, ShopDefinition>;
  catalogue: ItemCatalog;
  encounters: Map<string, EncounterTable>;
  commands: Record<string, (arg: string | undefined, game: Game) => boolean>;
  onAction: ((action: GameAction, game: Game) => boolean) | null;
}

export class Game implements ScriptHost {
  readonly rng: Rng;
  readonly inventory: Inventory;
  readonly collection: Specimen[] = [];
  readonly sceneStack = new SceneStack();
  readonly events: GameEvent[] = [];

  private readonly content: ResolvedContent;
  private readonly listeners = new Map<GameEvent["type"], Set<(event: GameEvent) => void>>();
  private readonly shopRuntimes = new Map<string, Shop>();
  private readonly mapsById: Map<string, GameMap>;
  private readonly npcs: ActorState[] = [];
  private player: ActorState;
  private camera: CameraState = { x: 0, y: 0 };
  private viewport: Size = { width: 0, height: 0 };
  private cameraSmoothing = 1;
  private readonly flags = new Map<string, boolean>();
  private readonly tallies = new Map<string, number>();
  private readonly encounterRng: Rng;
  private readonly extras: Record<string, unknown> = {};
  private readonly stepMs: number;
  private tileSizeValue: number;
  private readonly dayLengthMs: number;
  private clockMsValue = 0;
  private lastPhase: DayPhase = "dawn";
  private dialogue: DialogueSession | null = null;
  private dialogueScriptId: string | null = null;
  private dialogueSpeaker: string | null = null;
  private activeShopId: string | null = null;
  private encounterValue: { table: string; entry: string } | null = null;
  private started = false;

  constructor(content: GameContent) {
    this.rng = createRng(content.seed ?? "vroomon");
    this.encounterRng = this.rng.fork("encounters");
    this.stepMs = content.stepMs ?? 140;
    this.tileSizeValue = content.tileSize ?? 32;
    this.dayLengthMs = content.dayLengthMs ?? 24 * 60 * 1000;

    const tilesets = new Map<string, TileSet>();
    for (const entry of content.tilesets) {
      if (tilesets.has(entry.id)) {
        throw new Error(`two tilesets share the id "${entry.id}"`);
      }
      tilesets.set(entry.id, createTileSet(entry.id, entry.tiles));
    }

    const mapsById = new Map<string, GameMap>();
    for (const definition of content.maps) {
      if (mapsById.has(definition.id)) {
        throw new Error(`two maps share the id "${definition.id}"`);
      }
      const tileset = tilesets.get(definition.tileset);
      if (!tileset) {
        throw new Error(`map "${definition.id}" names a missing tileset "${definition.tileset}"`);
      }
      mapsById.set(definition.id, defineMap(definition, tileset));
    }

    const problems = validateMapGraph(mapsById, tilesets);
    if (problems.length > 0) {
      throw new Error(`the map graph is not walkable:\n  - ${problems.join("\n  - ")}`);
    }

    const dialogues = new Map<string, DialogueScript>();
    for (const definition of content.dialogues ?? []) {
      if (dialogues.has(definition.id)) {
        throw new Error(`two dialogues share the id "${definition.id}"`);
      }
      dialogues.set(definition.id, createDialogueScript(definition));
    }

    const shops = new Map<string, ShopDefinition>();
    for (const definition of content.shops ?? []) {
      if (shops.has(definition.id)) {
        throw new Error(`two shops share the id "${definition.id}"`);
      }
      shops.set(definition.id, definition);
    }

    const encounters = new Map<string, EncounterTable>();
    for (const table of content.encounters ?? []) {
      if (encounters.has(table.id)) {
        throw new Error(`two encounter tables share the id "${table.id}"`);
      }
      encounters.set(table.id, table);
    }

    this.content = {
      tilesets,
      maps: mapsById,
      dialogues,
      shops,
      encounters,
      catalogue: createItemCatalog(content.items ?? []),
      commands: content.commands ?? {},
      onAction: content.onAction ?? null,
    };
    this.mapsById = mapsById;
    this.inventory = new Inventory();

    const first = mapsById.keys().next().value;
    if (first === undefined) {
      throw new Error("a game needs at least one map");
    }
    const entry = this.map(first);
    this.player = createActorState({
      id: "player",
      kind: "player",
      mapId: first,
      x: 1,
      y: 1,
      facing: "down",
      stepDurationMs: this.stepMs,
    });
    void entry;
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Put the player down on a map and start the clock. */
  start(mapId: string, x?: number, y?: number, facing: Facing = "down"): void {
    const map = this.map(mapId);
    const spawn = findOpenTile(map, this.tilesetFor(map), x ?? 1, y ?? 1);
    this.player = createActorState({
      id: "player",
      kind: "player",
      mapId,
      x: spawn.x,
      y: spawn.y,
      facing,
      stepDurationMs: this.stepMs,
    });
    this.rebuildNpcs();
    this.snapCamera();
    this.started = true;
    this.emit({ type: "warp", from: mapId, to: mapId, x: spawn.x, y: spawn.y });
  }

  /** Advance the world by one frame. */
  update(deltaMs: number): void {
    this.updateClock(deltaMs);

    const active = this.activeScene();
    if (active) {
      this.sceneStack.update(deltaMs);
    }

    // The world only moves when nothing modal is open — a conversation stops
    // time for everyone, not just the player.
    if (!this.worldIsFrozen()) {
      const { actors, arrived } = advanceActors([this.player, ...this.npcs], deltaMs);
      this.player = actors[0]!;
      for (let index = 0; index < this.npcs.length; index += 1) {
        this.npcs[index] = actors[index + 1]!;
      }
      for (const actor of arrived) {
        if (actor.id !== "player") {
          continue;
        }
        this.onPlayerArrived();
      }
    }

    this.updateCamera();
  }

  private updateClock(deltaMs: number): void {
    if (deltaMs <= 0) {
      return;
    }
    this.clockMsValue += deltaMs;
    const phase = phaseName(this.dayFraction);
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.rebuildNpcs();
    }
  }

  // ---- input ---------------------------------------------------------------

  /**
   * Feed the game one action. Overlays get first refusal; then the player
   * moves, or interacts with whatever is in front of them.
   */
  input(action: GameAction): boolean {
    const active = this.activeScene();
    if (active && this.sceneStack.input(action)) {
      return true;
    }

    if (this.encounterValue) {
      if (action === "confirm" || action === "cancel") {
        this.resolveEncounter();
        return true;
      }
      return true;
    }

    if (this.activeShopId) {
      if (action === "cancel" || action === "menu") {
        this.closeShop();
        return true;
      }
      return true;
    }

    if (this.dialogue) {
      if (action === "confirm") {
        this.dialogue.advance();
        this.syncDialogue();
        return true;
      }
      if (action === "cancel") {
        this.closeDialogue();
        return true;
      }
      return true;
    }

    switch (action) {
      case "up":
      case "down":
      case "left":
      case "right":
        this.tryMove(action);
        return true;
      case "confirm":
        this.interact();
        return true;
      default:
        return this.content.onAction?.(action, this) ?? false;
    }
  }

  /** Walk one tile, or turn in place when the way is blocked. */
  tryMove(facing: Facing): boolean {
    if (!this.started || this.worldIsFrozen() || isStepping(this.player)) {
      return false;
    }
    const step = facingVector(facing);
    const target = { x: this.player.x + step.x, y: this.player.y + step.y };
    if (!this.canStepOnto(target.x, target.y, this.player.id)) {
      this.player = turnTo(this.player, facing);
      return false;
    }
    this.player = beginStep(this.player, facing, this.stepMs);
    return true;
  }

  /**
   * Talk to whoever is in front of the player. A person with no script is
   * simply not there yet, which is data, not a crash.
   */
  interact(): boolean {
    if (!this.started) {
      return false;
    }
    const ahead = facingTile(this.player);
    const npc = this.npcs.find((actor) => !actor.hidden && actor.x === ahead.x && actor.y === ahead.y);
    if (!npc) {
      return false;
    }
    const spawn = this.map(this.player.mapId).actors.find((actor) => actor.id === npc.id);
    if (!spawn?.dialogue) {
      return false;
    }
    return this.openDialogue(spawn.dialogue, spawn.name ?? spawn.id);
  }

  // ---- dialogue / shops ----------------------------------------------------

  openDialogue(scriptId: string, speaker: string | null = null): boolean {
    const script = this.content.dialogues.get(scriptId);
    if (!script) {
      return false;
    }
    this.dialogueScriptId = scriptId;
    this.dialogueSpeaker = speaker;
    const session = new DialogueSession(script, this);
    if (this.activeShopId) {
      // A start-node effect opened a shop: the conversation was the doorway,
      // not the room. Do not leave both on screen.
      this.dialogueScriptId = null;
      this.dialogueSpeaker = null;
      return true;
    }
    if (!session.isOpen()) {
      this.dialogueScriptId = null;
      this.dialogueSpeaker = null;
      return false;
    }
    this.dialogue = session;
    this.emit({ type: "dialogue", scriptId });
    return true;
  }

  closeDialogue(): void {
    if (!this.dialogue) {
      return;
    }
    this.dialogue = null;
    this.dialogueScriptId = null;
    this.dialogueSpeaker = null;
    this.emit({ type: "dialogue", scriptId: null });
  }

  /** Choose an option in the open conversation. */
  choose(optionIndex: number): boolean {
    if (!this.dialogue) {
      return false;
    }
    const chosen = this.dialogue.choose(optionIndex);
    this.syncDialogue();
    return chosen;
  }

  private syncDialogue(): void {
    if (this.dialogue && !this.dialogue.isOpen()) {
      this.closeDialogue();
    }
  }

  openShop(shopId: string): boolean {
    const runtime = this.shop(shopId);
    if (!runtime) {
      return false;
    }
    this.closeDialogue();
    this.activeShopId = shopId;
    this.emit({ type: "shop", shopId });
    return true;
  }

  closeShop(): void {
    if (!this.activeShopId) {
      return;
    }
    this.activeShopId = null;
    this.emit({ type: "shop", shopId: null });
  }

  buy(item: string, count = 1): TradeResult {
    const runtime = this.activeShopId ? this.shop(this.activeShopId) : null;
    if (!runtime) {
      return { ok: false, reason: "no-item" };
    }
    const result = runtime.buy(item, count);
    if (result.ok) {
      this.emit({ type: "item", item: result.item, count: result.count });
      this.emit({ type: "coins", coins: this.inventory.coins });
    }
    return result;
  }

  sell(item: string, count = 1): TradeResult {
    const runtime = this.activeShopId ? this.shop(this.activeShopId) : null;
    if (!runtime) {
      return { ok: false, reason: "no-item" };
    }
    const result = runtime.sell(item, count);
    if (result.ok) {
      this.emit({ type: "item", item: result.item, count: -result.count });
      this.emit({ type: "coins", coins: this.inventory.coins });
    }
    return result;
  }

  // ---- script host ---------------------------------------------------------

  getFlag(flag: string): boolean {
    return this.flags.get(flag) === true;
  }

  setFlag(flag: string, value: boolean): void {
    if (this.getFlag(flag) === value) {
      return;
    }
    this.flags.set(flag, value);
    this.emit({ type: "flag", flag, value });
  }

  countItem(item: string): number {
    return this.inventory.count(item);
  }

  tally(key: string): number {
    return this.tallies.get(key) ?? 0;
  }

  /** Add to a counter. The game's own events are what bump these. */
  bumpTally(key: string, amount = 1): number {
    const next = Math.max(0, this.tally(key) + amount);
    this.tallies.set(key, next);
    return next;
  }

  coins(): number {
    return this.inventory.coins;
  }

  /** The verbs a conversation can ask for. */
  run(command: string, arg?: string): boolean {
    switch (command) {
      case "give": {
        const { item, count } = parseItemArg(arg);
        this.inventory.add(item, count);
        this.emit({ type: "item", item, count });
        return true;
      }
      case "take": {
        const { item, count } = parseItemArg(arg);
        const removed = this.inventory.remove(item, count);
        if (removed) {
          this.emit({ type: "item", item, count: -count });
        }
        return removed;
      }
      case "coins": {
        const amount = Number(arg ?? 0);
        if (!Number.isFinite(amount)) {
          return false;
        }
        if (amount < 0 && this.inventory.coins < -amount) {
          return false;
        }
        this.inventory.addCoins(amount);
        this.emit({ type: "coins", coins: this.inventory.coins });
        return true;
      }
      case "shop":
        return arg ? this.openShop(arg) : false;
      case "warp": {
        const parsed = parseWarpArg(arg);
        if (!parsed) {
          return false;
        }
        this.closeDialogue();
        this.transitionTo(parsed.mapId, parsed.x, parsed.y, parsed.facing);
        return true;
      }
      case "encounter": {
        if (!arg) {
          return false;
        }
        this.rollEncounter(arg, true);
        return true;
      }
      case "close-dialogue":
        this.closeDialogue();
        return true;
      default: {
        const handler = this.content.commands[command];
        if (!handler) {
          this.emit({ type: "command", command, arg });
          return false;
        }
        const handled = handler(arg, this);
        if (handled) {
          this.emit({ type: "command", command, arg });
        }
        return handled;
      }
    }
  }

  // ---- world ---------------------------------------------------------------

  get mapId(): string {
    return this.player.mapId;
  }

  get playerState(): ActorState {
    return this.player;
  }

  get npcStates(): readonly ActorState[] {
    return this.npcs;
  }

  get isBusy(): boolean {
    return this.worldIsFrozen();
  }

  get clockMs(): number {
    return this.clockMsValue;
  }

  get dayFraction(): number {
    return this.dayLengthMs <= 0 ? 0 : (this.clockMsValue % this.dayLengthMs) / this.dayLengthMs;
  }

  /** Pin the hour (a test, or a fast-forward). */
  setClock(ms: number): void {
    this.clockMsValue = ms;
    this.lastPhase = phaseName(this.dayFraction);
    this.rebuildNpcs();
  }

  /** Set the in-game time by fraction of the day. */
  setDayFraction(fraction: number): void {
    const clamped = Math.max(0, Math.min(0.999, fraction));
    this.setClock(Math.floor(clamped * this.dayLengthMs));
  }

  setViewport(viewport: Size, smoothing = 1): void {
    this.viewport = { ...viewport };
    this.cameraSmoothing = smoothing;
    this.snapCamera();
  }

  setTileSize(tileSize: number): void {
    this.tileSizeValue = tileSize;
  }

  get tileSize(): number {
    return this.tileSizeValue;
  }

  /** Warp to another map. Fires `warp`; keeps every other piece of state. */
  transitionTo(mapId: string, x: number, y: number, facing?: Facing): void {
    const from = this.player.mapId;
    const map = this.map(mapId);
    const spawn = findOpenTile(map, this.tilesetFor(map), x, y);
    this.player = {
      ...this.player,
      mapId,
      x: spawn.x,
      y: spawn.y,
      facing: facing ?? this.player.facing,
      stepFrom: null,
      stepProgress: 0,
    };
    this.rebuildNpcs();
    this.snapCamera();
    this.emit({ type: "warp", from, to: mapId, x: spawn.x, y: spawn.y });
  }

  map(mapId: string): GameMap {
    const map = this.mapsById.get(mapId);
    if (!map) {
      throw new Error(`no such map "${mapId}"`);
    }
    return map;
  }

  tilesetFor(map: GameMap): TileSet {
    const tileset = this.content.tilesets.get(map.tileset);
    if (!tileset) {
      throw new Error(`map "${map.id}" names a missing tileset "${map.tileset}"`);
    }
    return tileset;
  }

  canStepOnto(x: number, y: number, ignoreId?: string): boolean {
    const map = this.map(this.player.mapId);
    if (isSolidTile(map, this.tilesetFor(map), x, y)) {
      return false;
    }
    const key = tileKey(x, y);
    if (this.player.id !== ignoreId && this.player.x === x && this.player.y === y) {
      return false;
    }
    return !this.npcs.some((npc) => !npc.hidden && tileKey(npc.x, npc.y) === key);
  }

  /** Choose what is in the encounter slot, or roll for it when `force`. */
  rollEncounter(tableId: string, force = false): string | null {
    const table = this.content.encounters.get(tableId);
    if (!table || table.entries.length === 0) {
      return null;
    }
    if (!force && !this.encounterRng.bool(table.chance ?? 1)) {
      return null;
    }
    const entry = this.encounterRng.pick(table.entries);
    this.encounterValue = { table: tableId, entry };
    this.emit({ type: "encounter", table: tableId, entry, mapId: this.player.mapId });
    return entry;
  }

  get encounter(): { table: string; entry: string } | null {
    return this.encounterValue;
  }

  /** Hand the encounter back to the world: the battle (or the catch) is over. */
  resolveEncounter(): { table: string; entry: string } | null {
    if (!this.encounterValue) {
      return null;
    }
    const resolved = this.encounterValue;
    this.encounterValue = null;
    this.emit({ type: "encounter-resolved", table: resolved.table });
    return resolved;
  }

  // ---- scenes --------------------------------------------------------------

  pushScene(scene: Scene): void {
    this.sceneStack.push(scene);
  }

  popScene(): Scene | null {
    return this.sceneStack.pop();
  }

  activeScene(): Scene | null {
    return this.sceneStack.top();
  }

  // ---- viewing -------------------------------------------------------------

  /** Everything a renderer needs for one frame, and nothing else. */
  view(): GameView {
    const map = this.map(this.player.mapId);
    const actors: GameViewActor[] = [
      this.viewActor(this.player, "player", "player", null, null),
      ...this.npcs
        .filter((npc) => !npc.hidden)
        .map((npc) => {
          const spawn = map.actors.find((actor) => actor.id === npc.id);
          return this.viewActor(npc, "npc", spawn?.sprite ?? npc.id, spawn?.name ?? null, spawn?.dialogue ?? null);
        }),
    ].sort((left, right) => left.y - right.y);

    const shopRuntime = this.activeShopId ? this.shop(this.activeShopId) : null;
    const node = this.dialogue?.current() ?? null;
    const visible = this.dialogue?.options() ?? [];
    const active = this.activeScene();

    return {
      map,
      camera: { ...this.camera },
      tileSize: this.tileSizeValue,
      actors,
      dialogue: node
        ? {
            scriptId: this.dialogueScriptId ?? "",
            speaker: this.dialogueSpeaker,
            text: node.text,
            options: visible.map((option) => option.label),
          }
        : null,
      shop: shopRuntime
        ? {
            id: shopRuntime.id,
            name: shopRuntime.name,
            offers: shopRuntime.offers(),
            coins: this.inventory.coins,
          }
        : null,
      encounter: this.encounterValue,
      sceneId: active?.id ?? null,
      scene: active?.view?.() ?? null,
      clock: {
        ms: this.clockMsValue,
        fraction: this.dayFraction,
        phase: this.lastPhase,
      },
    };
  }

  /** The names of the five day phases, in order, for a clock display. */
  static get dayPhases(): readonly DayPhase[] {
    return DAY_PHASES;
  }

  // ---- persistence ---------------------------------------------------------

  snapshot(): GameSnapshot {
    const shops: Record<string, ShopState> = {};
    for (const [id, runtime] of this.shopRuntimes) {
      shops[id] = runtime.snapshot();
    }
    return {
      seed: this.rng.seed,
      mapId: this.player.mapId,
      x: this.player.x,
      y: this.player.y,
      facing: this.player.facing,
      clockMs: this.clockMsValue,
      flags: Object.fromEntries(this.flags),
      inventory: this.inventory.snapshot(),
      collection: [...this.collection],
      shops,
      extra: { ...this.extras },
    };
  }

  save(registry: SaveRegistry = createGameSaveRegistry()): string {
    return encodeSave(this.snapshot(), registry);
  }

  /**
   * Restore a save. Returns false for unreadable, newer, or unmigratable data,
   * leaving the running game untouched rather than half-loaded.
   */
  load(text: string, registry: SaveRegistry = createGameSaveRegistry()): boolean {
    const decoded = decodeSave(text, registry);
    if (!decoded) {
      return false;
    }
    const data = decoded.data as Partial<GameSnapshot> | null;
    if (!data || typeof data !== "object" || typeof data.mapId !== "string") {
      return false;
    }
    if (!this.mapsById.has(data.mapId)) {
      return false;
    }
    const desired = new Inventory(data.inventory);
    for (const { item, count } of this.inventory.items()) {
      this.inventory.remove(item, count);
    }
    this.inventory.addCoins(desired.coins - this.inventory.coins);
    for (const { item, count } of desired.items()) {
      this.inventory.add(item, count);
    }

    this.flags.clear();
    for (const [flag, value] of Object.entries(data.flags ?? {})) {
      this.flags.set(flag, value === true);
    }
    this.collection.length = 0;
    this.collection.push(...(data.collection ?? []));

    for (const [id, state] of Object.entries(data.shops ?? {})) {
      this.shop(id)?.restore(state);
    }

    this.clockMsValue = typeof data.clockMs === "number" ? data.clockMs : 0;
    this.lastPhase = phaseName(this.dayFraction);
    for (const key of Object.keys(this.extras)) {
      delete this.extras[key];
    }
    Object.assign(this.extras, data.extra ?? {});

    this.start(data.mapId, data.x, data.y, data.facing ?? "down");
    return true;
  }

  // ---- events --------------------------------------------------------------

  on<T extends GameEvent["type"]>(
    type: T,
    handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler as (event: GameEvent) => void);
    this.listeners.set(type, set);
    return () => {
      set.delete(handler as (event: GameEvent) => void);
    };
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
    while (this.events.length > 64) {
      this.events.shift();
    }
    for (const handler of this.listeners.get(event.type) ?? []) {
      handler(event);
    }
  }

  // ---- internals -----------------------------------------------------------

  private worldIsFrozen(): boolean {
    return Boolean(this.dialogue || this.activeShopId || this.encounterValue || this.sceneStack.depth > 0);
  }

  private shop(shopId: string): Shop | null {
    const definition = this.content.shops.get(shopId);
    if (!definition) {
      return null;
    }
    let runtime = this.shopRuntimes.get(shopId);
    if (!runtime) {
      runtime = new Shop(definition, this.inventory, this.content.catalogue);
      this.shopRuntimes.set(shopId, runtime);
    }
    return runtime;
  }

  private onPlayerArrived(): void {
    const map = this.map(this.player.mapId);
    const tileset = this.tilesetFor(map);
    const warp = warpAt(map, this.player.x, this.player.y);
    if (warp) {
      this.transitionTo(warp.toMap, warp.to.x, warp.to.y, warp.facing);
      return;
    }
    const tile = map.tiles.get(this.player.x, this.player.y);
    if (tile === undefined) {
      return;
    }
    const table = tileset.encounterFor(tile);
    if (table && !this.encounterValue) {
      this.rollEncounter(table);
    }
  }

  private rebuildNpcs(): void {
    this.npcs.length = 0;
    const map = this.map(this.player.mapId);
    const fraction = this.dayFraction;
    for (const spawn of map.actors) {
      if (spawn.routine) {
        const stop = resolveRoutine(spawn.routine, fraction);
        if (!stop) {
          continue;
        }
        this.npcs.push(
          createActorState({
            id: spawn.id,
            mapId: map.id,
            x: stop.x,
            y: stop.y,
            facing: stop.facing ?? spawn.facing,
            stepDurationMs: this.stepMs,
          }),
        );
        continue;
      }
      this.npcs.push(
        createActorState({
          id: spawn.id,
          mapId: map.id,
          x: spawn.x,
          y: spawn.y,
          facing: spawn.facing,
          stepDurationMs: this.stepMs,
        }),
      );
    }
  }

  private viewActor(
    actor: ActorState,
    kind: "player" | "npc",
    sprite: string,
    name: string | null,
    dialogue: string | null,
  ): GameViewActor {
    return {
      id: actor.id,
      kind,
      sprite,
      name,
      x: actor.x,
      y: actor.y,
      facing: actor.facing,
      pixel: actorPixel(actor, this.tileSizeValue),
      stepping: isStepping(actor),
      dialogue,
    };
  }

  private updateCamera(): void {
    this.camera = cameraForActor(
      actorPixel(this.player, this.tileSizeValue),
      this.tileSizeValue,
      this.viewport,
      { width: this.map(this.player.mapId).width * this.tileSizeValue, height: this.map(this.player.mapId).height * this.tileSizeValue },
      this.cameraSmoothing,
      this.camera,
    );
  }

  private snapCamera(): void {
    const map = this.map(this.player.mapId);
    this.camera = cameraForActor(
      actorPixel(this.player, this.tileSizeValue),
      this.tileSizeValue,
      this.viewport,
      { width: map.width * this.tileSizeValue, height: map.height * this.tileSizeValue },
    );
  }
}

function findOpenTile(map: GameMap, tileset: TileSet, x: number, y: number): Cell {
  if (!isSolidTile(map, tileset, x, y)) {
    return { x, y };
  }
  let bestX = -1;
  let bestY = -1;
  let bestDistance = Infinity;
  for (let tileY = 0; tileY < map.height; tileY += 1) {
    for (let tileX = 0; tileX < map.width; tileX += 1) {
      if (isSolidTile(map, tileset, tileX, tileY)) {
        continue;
      }
      const distance = Math.abs(tileX - x) + Math.abs(tileY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestX = tileX;
        bestY = tileY;
      }
    }
  }
  if (bestX === -1) {
    throw new Error(`map "${map.id}" has nowhere to stand`);
  }
  return { x: bestX, y: bestY };
}

function parseItemArg(arg: string | undefined): { item: string; count: number } {
  const [item, rawCount] = (arg ?? "").split(":");
  const count = Number(rawCount ?? 1);
  return { item: item ?? "", count: Number.isFinite(count) && count > 0 ? Math.trunc(count) : 1 };
}

function parseWarpArg(
  arg: string | undefined,
): { mapId: string; x: number; y: number; facing?: Facing } | null {
  const [mapId, rawX, rawY, facing] = (arg ?? "").split(":");
  const x = Number(rawX);
  const y = Number(rawY);
  if (!mapId || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const facingValue =
    facing === "up" || facing === "down" || facing === "left" || facing === "right" ? facing : undefined;
  return { mapId, x, y, ...(facingValue ? { facing: facingValue } : {}) };
}
