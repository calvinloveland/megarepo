import {Interpreter} from '../material_runtime/interpreter';
import { stepByTags } from './tag_movement';

export type WorkerMessage =
  | {type:'init', width:number, height:number}
  | {type:'step'}
  | {type:'set_material', material:any, materialId:number}
  | {type:'set_grid', buffer:ArrayBuffer}
  | {type:'paint_points', materialId:number, points:{x:number,y:number}[]}
  ;

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
  at: 'top';
  result: string;
  probability?: number;
  resultId?: number;
};

let width=0, height=0;
let grid: Uint16Array;
let nextGrid: Uint16Array;
const interpreters = new Map<number, Interpreter>();
const reactionsById = new Map<number, ReactionRule[]>();
const condenseById = new Map<number, CondenseRule>();
const nameToId = new Map<string, number>();
const densityById = new Map<number, number>();
const tagsById = new Map<number, string[]>();
let reacted: Uint8Array;

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
  if (msg.type === 'init') {
    width = msg.width; height = msg.height;
    grid = new Uint16Array(width*height);
    nextGrid = new Uint16Array(width*height);
    reacted = new Uint8Array(width*height);
    postMessage({type:'ready'});
  } else if (msg.type === 'set_material') {
    const hasPrimitives = Array.isArray(msg.material?.primitives) && msg.material.primitives.length > 0;
    if (hasPrimitives) {
      interpreters.set(msg.materialId, new Interpreter(msg.material));
    } else {
      interpreters.delete(msg.materialId);
    }
    if (msg.material?.name) nameToId.set(msg.material.name, msg.materialId);
    const density = typeof msg.material?.density === 'number' ? msg.material.density : 1;
    densityById.set(msg.materialId, density);
    if (Array.isArray(msg.material?.tags)) {
      const tags = msg.material.tags
        .filter((tag:any)=> typeof tag === 'string')
        .map((tag:string)=> tag.trim().toLowerCase());
      tagsById.set(msg.materialId, tags);
    } else {
      tagsById.delete(msg.materialId);
    }
    if (Array.isArray(msg.material?.reactions)) {
      const rules = msg.material.reactions.slice().sort((a:ReactionRule,b:ReactionRule)=> (b.priority||0) - (a.priority||0));
      reactionsById.set(msg.materialId, rules);
    }
    if (msg.material?.condense?.at === 'top' && msg.material?.condense?.result) {
      condenseById.set(msg.materialId, { at: 'top', result: msg.material.condense.result, probability: msg.material.condense.probability });
    }
    resolveReactions();
    postMessage({type:'material_set', materialId: msg.materialId});
  } else if (msg.type === 'set_grid') {
    // accept transferred buffer as the new grid if size matches
    const buf = new Uint16Array(msg.buffer);
    if (buf.length === width*height) {
      grid = buf;
      nextGrid = new Uint16Array(width*height);
      postMessage({type:'grid_set'});
    } else {
      postMessage({type:'error', message:'grid size mismatch'});
    }
  } else if (msg.type === 'paint_points') {
    for (const p of msg.points) {
      const idx = p.y*width + p.x;
      if (idx>=0 && idx<grid.length) grid[idx] = msg.materialId;
    }
    // return the current grid so the UI can render the paint immediately
    postMessage({type:'grid_set', grid: grid.buffer, width, height});
  } else if (msg.type === 'step') {
    stepSimulation();
    // swap buffers
    const t = grid; grid = nextGrid; nextGrid = t;
    postMessage({type:'stepped', grid: grid.buffer, width, height});
  }
}

function stepSimulation() {
  if (!interpreters.size && !tagsById.size && !reactionsById.size && !condenseById.size) return;
  // clear next grid each tick to avoid accumulating cells
  nextGrid.fill(0);
  reacted.fill(0);
  const dirs = [
    {dx:0, dy:-1},
    {dx:0, dy:1},
    {dx:-1, dy:0},
    {dx:1, dy:0}
  ];
  // naive per-cell loop for MVP
  for (let y=height-1;y>=0;y--) {
    for (let x=0;x<width;x++) {
      const idx = y*width + x;
      const cell = grid[idx];
      if (cell === 0) {
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
            if (nx<0||nx>=width||ny<0||ny>=height) continue;
            const nidx = ny*width + nx;
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
            break;
          }
          if (reactedHere) break;
        }
      }
      if (reactedHere) continue;
      const tags = tagsById.get(cell) || [];
      if (tags.length) {
        const moved = stepByTags(tags, cell, x, y, idx, {
          width,
          height,
          grid,
          nextGrid,
          densityById
        });
        if (!moved && nextGrid[idx] === 0) nextGrid[idx] = cell;
        continue;
      }
      const interpreter = interpreters.get(cell);
      if (!interpreter) {
        nextGrid[idx] = cell;
        continue;
      }
      const ctx = makeCellCtx(x,y,cell);
      interpreter.step(ctx);
      if (ctx.intent && ctx.intent.type === 'move') {
        const nx = x + ctx.intent.dx;
        const ny = y + ctx.intent.dy;
        if (nx>=0 && nx<width && ny>=0 && ny<height) {
          const nidx = ny*width + nx;
          const target = grid[nidx];
          if (target === 0 && nextGrid[nidx] === 0) {
            nextGrid[nidx] = cell;
          } else if (target !== 0) {
            const dSelf = densityById.get(cell) ?? 1;
            const dTarget = densityById.get(target) ?? 1;
            if (dSelf > dTarget && nextGrid[idx] === 0 && (nextGrid[nidx] === 0 || nextGrid[nidx] === target)) {
              nextGrid[nidx] = cell;
              nextGrid[idx] = target;
            } else if (nextGrid[idx] === 0) {
              nextGrid[idx] = cell;
            }
          } else if (nextGrid[idx] === 0) {
            nextGrid[idx] = cell;
          }
        } else {
          nextGrid[idx] = cell;
        }
      } else {
        if (nextGrid[idx] === 0) nextGrid[idx] = cell;
      }
    }
  }
}

function makeCellCtx(x:number,y:number, cellId:number) {
  return {
    readNeighbor: (dx:number, dy:number) => {
      const nx = x+dx, ny=y+dy;
      if (nx<0||nx>=width||ny<0||ny>=height) return 0;
      const neighbor = grid[ny*width + nx];
      if (neighbor === 0) return 0;
      const selfDensity = densityById.get(cellId) ?? 1;
      const neighborDensity = densityById.get(neighbor) ?? 1;
      return neighborDensity < selfDensity ? 0 : neighbor;
    },
    lastRead: 0,
    intent: null
  }
}
