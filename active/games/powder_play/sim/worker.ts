import {Interpreter} from '../material_runtime/interpreter';

export type WorkerMessage =
  | {type:'init', width:number, height:number}
  | {type:'step'}
  | {type:'set_material', material:any}
  ;

let width=0, height=0;
let grid: Uint16Array;
let nextGrid: Uint16Array;
let interpreter: Interpreter | null = null;

onmessage = (ev: MessageEvent) => {
  const msg: WorkerMessage = ev.data;
  if (msg.type === 'init') {
    width = msg.width; height = msg.height;
    grid = new Uint16Array(width*height);
    nextGrid = new Uint16Array(width*height);
    postMessage({type:'ready'});
  } else if (msg.type === 'set_material') {
    interpreter = new Interpreter(msg.material);
    postMessage({type:'material_set'});
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
  } else if (msg.type === 'step') {
    stepSimulation();
    postMessage({type:'stepped', grid: grid.buffer, width, height});
    // swap buffers
    const t = grid; grid = nextGrid; nextGrid = t;
  }
}

function stepSimulation() {
  if (!interpreter) return;
  // naive per-cell loop for MVP
  for (let y=height-1;y>=0;y--) {
    for (let x=0;x<width;x++) {
      const idx = y*width + x;
      const cell = grid[idx];
      const ctx = makeCellCtx(x,y);
      interpreter.step(ctx);
      if (ctx.intent && ctx.intent.type === 'move') {
        const nx = x + ctx.intent.dx;
        const ny = y + ctx.intent.dy;
        if (nx>=0 && nx<width && ny>=0 && ny<height) {
          nextGrid[ny*width + nx] = cell;
        } else {
          nextGrid[idx] = cell;
        }
      } else {
        nextGrid[idx] = cell;
      }
    }
  }
}

function makeCellCtx(x:number,y:number) {
  return {
    readNeighbor: (dx:number, dy:number) => {
      const nx = x+dx, ny=y+dy;
      if (nx<0||nx>=width||ny<0||ny>=height) return 0;
      return grid[ny*width + nx];
    },
    lastRead: 0,
    intent: null
  }
}
