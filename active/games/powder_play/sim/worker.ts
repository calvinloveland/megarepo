import { stepByTags } from "./tag_movement";
import { applyTagBehaviors } from "./tag_behaviors";
import { applyPressureWind, simulatePressureField } from "./pressure_wind";
import { applyDrains } from "./drain";

export type WorkerMessage =
  | { type: "init"; width: number; height: number }
  | { type: "step" }
  | { type: "set_material"; material: any; materialId: number }
  | { type: "set_grid"; buffer: ArrayBuffer }
  | {
      type: "paint_points";
      materialId: number;
      points: { x: number; y: number }[];
    };

type ReactionRule = {
  with: string;
  result: string;
  byproduct?: string;
  probability?: number;
  priority?: number;
  withId?: number;
  resultId?: number;
  byproductId?: number;
};

type CondenseRule = {
  at: "top";
  result: string;
  probability?: number;
  resultId?: number;
};

let width = 0,
  height = 0;
let grid: Uint16Array;
let nextGrid: Uint16Array;
const reactionsById = new Map<number, ReactionRule[]>();
const condenseById = new Map<number, CondenseRule>();
const nameToId = new Map<string, number>();
const densityById = new Map<number, number>();
const tagsById = new Map<number, string[]>();
const burnoutRateById = new Map<number, number>();
const emitsById = new Map<number, number>(); // source: what material it spawns
let stepCount = 0; // global tick counter for periodic behaviors
let pressure: Float32Array; // per-cell pressure field
let reacted: Uint8Array;

function summarizePressure(field: Float32Array) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < field.length; i++) {
    const p = field[i] || 0;
    if (p < min) min = p;
    if (p > max) max = p;
    total += p;
  }
  if (!field.length) {
    min = 0;
    max = 0;
  }
  return { min, max, total, avg: field.length ? total / field.length : 0 };
}

function resolveReactions() {
  for (const rules of reactionsById.values()) {
    for (const r of rules) {
      r.withId = nameToId.get(r.with);
      r.resultId = nameToId.get(r.result);
      r.byproductId = r.byproduct ? nameToId.get(r.byproduct) : undefined;
    }
  }
  for (const r of condenseById.values()) {
    r.resultId = nameToId.get(r.result);
  }
}

onmessage = (ev: MessageEvent) => {
  const msg: WorkerMessage = ev.data;
  if (msg.type === "init") {
    width = msg.width;
    height = msg.height;
    grid = new Uint16Array(width * height);
    nextGrid = new Uint16Array(width * height);
    pressure = new Float32Array(width * height);
    reacted = new Uint8Array(width * height);
    postMessage({ type: "ready" });
  } else if (msg.type === "set_material") {
    if (msg.material?.name) nameToId.set(msg.material.name, msg.materialId);
    const density =
      typeof msg.material?.density === "number" ? msg.material.density : 1;
    densityById.set(msg.materialId, density);
    if (Array.isArray(msg.material?.tags)) {
      const tags = msg.material.tags
        .filter((tag: any) => typeof tag === "string")
        .map((tag: string) => tag.trim().toLowerCase());
      tagsById.set(msg.materialId, tags);
    } else {
      tagsById.delete(msg.materialId);
    }
    // Configurable burnout rate: how fast burns_out materials disappear
    const burnoutRate = typeof msg.material?.burnoutRate === "number" ? msg.material.burnoutRate : 0.08;
    burnoutRateById.set(msg.materialId, burnoutRate);
    // Source emitter: what material does this source spawn?
    const emits = msg.material?.emits;
    if (emits && typeof emits === "string") {
      const emitsId = nameToId.get(emits);
      if (emitsId) emitsById.set(msg.materialId, emitsId);
    } else {
      emitsById.delete(msg.materialId);
    }
    if (Array.isArray(msg.material?.reactions)) {
      const rules = msg.material.reactions
        .slice()
        .sort(
          (a: ReactionRule, b: ReactionRule) =>
            (b.priority || 0) - (a.priority || 0),
        );
      reactionsById.set(msg.materialId, rules);
    }
    if (
      msg.material?.condense?.at === "top" &&
      msg.material?.condense?.result
    ) {
      condenseById.set(msg.materialId, {
        at: "top",
        result: msg.material.condense.result,
        probability: msg.material.condense.probability,
      });
    }
    resolveReactions();
    postMessage({ type: "material_set", materialId: msg.materialId });
  } else if (msg.type === "set_grid") {
    // accept transferred buffer as the new grid if size matches
    const buf = new Uint16Array(msg.buffer);
    if (buf.length === width * height) {
      grid = buf;
      nextGrid = new Uint16Array(width * height);
      postMessage({ type: "grid_set" });
    } else {
      postMessage({ type: "error", message: "grid size mismatch" });
    }
  } else if (msg.type === "paint_points") {
    for (const p of msg.points) {
      const idx = p.y * width + p.x;
      if (idx >= 0 && idx < grid.length) grid[idx] = msg.materialId;
    }
    // return the current grid so the UI can render the paint immediately
    postMessage({ type: "grid_set", grid: grid.buffer, width, height });
  } else if (msg.type === "step") {
    stepSimulation();
    // swap buffers
    const t = grid;
    grid = nextGrid;
    nextGrid = t;
    postMessage({
      type: "stepped",
      grid: grid.buffer,
      width,
      height,
      pressureStats: summarizePressure(pressure),
    });
  }
};

function stepSimulation() {
  stepCount++;
  nextGrid.fill(0);
  reacted.fill(0);
  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ];

  // ── Phase 1: Process sources (spawn emitted materials) ──
  if (emitsById.size && stepCount % 8 === 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const cell = grid[idx];
        if (cell === 0) continue;
        const emitsId = emitsById.get(cell);
        if (!emitsId) continue;
        // Find a random empty adjacent cell to spawn into
        const neighbors: Array<[number, number]> = [];
        for (const d of dirs) {
          const nx = x + d.dx;
          const ny = y + d.dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          // Prefer empty cells in the next grid (not yet occupied this tick)
          if (nextGrid[nidx] === 0 && grid[nidx] === 0) {
            neighbors.push([nx, ny]);
          }
        }
        if (neighbors.length > 0) {
          const [nx, ny] = neighbors[Math.floor(Math.random() * neighbors.length)];
          nextGrid[ny * width + nx] = emitsId;
        }
      }
    }
  }

  // ── Phase 1.5: Pressure field simulation ──
  // Pressure now diffuses through the whole grid (including open space).
  // Wind emerges from changing pressure gradients, so light particles are
  // pushed from high-pressure regions toward low-pressure regions.
  pressure = simulatePressureField({
    width,
    height,
    grid,
    pressure,
    densityById,
    tagsById,
  });

  applyPressureWind({
    width,
    height,
    grid,
    nextGrid,
    pressure,
    densityById,
    tagsById,
    reacted,
  });

  // ── Phase 2: Process drains (absorb adjacent materials) ──
  const idToName = new Map<number, string>();
  for (const [name, id] of nameToId.entries()) idToName.set(id, name);
  applyDrains({
    width,
    height,
    grid,
    nextGrid,
    reacted,
    tagsById,
    nameById: idToName,
    onDrain: (materialName, amount) => {
      postMessage({ type: "drained", materialName, amount });
    },
  });

  // ── Phase 3: Main simulation loop ──
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[idx];
      if (cell === 0) continue;
      if (reacted[idx]) continue;
      const tags = tagsById.get(cell) || [];
      // Sources and drains stay in place, don't move or react further
      if (tags.includes("drain") || tags.includes("source")) {
        if (nextGrid[idx] === 0) nextGrid[idx] = cell;
        continue;
      }
      // condense at top if configured
      const condense = condenseById.get(cell);
      if (condense && y === 0) {
        const prob = condense.probability ?? 1;
        if (Math.random() <= prob) {
          const rid = condense.resultId;
          if (rid) {
            nextGrid[idx] = rid;
            reacted[idx] = 1;
            continue;
          }
        }
      }
      if (reacted[idx]) continue;
      if (tags.length) {
        const behavior = applyTagBehaviors(cell, x, y, idx, tags, {
          width,
          height,
          grid,
          nextGrid,
          tagsById,
          nameToId,
          reacted,
          burnoutRate: burnoutRateById.get(cell),
        });
        if (behavior.consumed) continue;
      }
      const rules = reactionsById.get(cell);
      let reactedHere = false;
      if (rules && rules.length) {
        for (const r of rules) {
          const withId = r.withId;
          const resultId = r.resultId;
          if (!withId || !resultId) continue;
          const prob = r.probability ?? 1;
          for (const d of dirs) {
            const nx = x + d.dx;
            const ny = y + d.dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nidx = ny * width + nx;
            if (reacted[nidx]) continue;
            if (grid[nidx] !== withId) continue;
            if (Math.random() > prob) continue;
            const byId = r.byproductId;
            if (nextGrid[idx] !== 0 || nextGrid[nidx] !== 0) continue;
            nextGrid[idx] = resultId;
            if (r.byproduct !== undefined) nextGrid[nidx] = byId ?? 0;
            else nextGrid[nidx] = withId;
            reacted[idx] = 1;
            reacted[nidx] = 1;
            reactedHere = true;
            postMessage({ type: "reaction", resultId, resultName: r.result });
            break;
          }
          if (reactedHere) break;
        }
      }
      if (reactedHere) continue;
      if (tags.length && !tags.includes("drain") && !tags.includes("source")) {
        const moved = stepByTags(tags, cell, x, y, idx, {
          width,
          height,
          grid,
          nextGrid,
          densityById,
          tagsById,
        });
        if (!moved && nextGrid[idx] === 0) nextGrid[idx] = cell;
        continue;
      }
      if (nextGrid[idx] === 0) nextGrid[idx] = cell;
    }
  }
}
