export function initApp(root: HTMLElement) {
  root.innerHTML = `
    <div style="display:flex; gap:1rem;">
      <div>
        <h1>Powder Playground</h1>
        <div id="controls"></div>
        <div id="status"></div>
      </div>
      <canvas id="sim-canvas" width="600" height="400" style="border:1px solid #ccc"></canvas>
    </div>
  `;

  const status = document.getElementById('status')!;
  status.textContent = 'Ready';

  // mount prompt editor
  const controls = document.getElementById('controls')!;
  // lazy import to keep initial bundle small
  import('./prompt_editor').then(m => {
    m.createPromptEditor(controls, (mat:any)=>{
      status.textContent = `Material ready: ${mat.name}`;
      // set material in worker
      initWorkerWithMaterial(mat);
    });
  });

  // mount materials browser
  import('./material_browser').then(m => {
    m.mountMaterialBrowser(controls);
  });

  // attach play/step controls
  import('./controls').then(mod => {
    mod.attachControls(controls, (playingOrStep:boolean)=>{
      // playingOrStep true for a tick, false for pause action
      if (!worker) return;
      if (playingOrStep) worker.postMessage({type:'step'});
      else worker.postMessage({type:'step'});
    });
  });

  // attach canvas tools immediately (it will queue paints until worker exists)
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;

  // Setup canvas for devicePixelRatio to reduce blurriness
  function setupCanvasDPR(c: HTMLCanvasElement, cssW = 600, cssH = 400) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.floor(cssW * dpr);
    c.height = Math.floor(cssH * dpr);
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    return {dpr, cssW, cssH};
  }
  const _dpr = setupCanvasDPR(canvas, 600, 400);

  import('./canvas_tools').then(mod => {
    mod.attachCanvasTools(canvas, (window as any).__powderWorker || null, 150, 100);
  });

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

let worker: Worker | null = null;
let nextMaterialId = 0;
let currentMaterialId = 0;
function initWorkerWithMaterial(mat:any) {
  if (!worker) {
    // worker script lives at the project-level `sim/worker.ts`, so go up one more dir
    // prefer worker script inside frontend/src to avoid @fs 403 issues
    worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') {
        console.log('worker ready');
        // expose the worker to the page for e2e tests/debugging
        (window as any).__powderWorker = worker;
        // attach canvas tools once worker exists
        import('./canvas_tools').then(mod => {
          mod.attachCanvasTools(document.getElementById('sim-canvas') as HTMLCanvasElement, worker!, 150, 100);
        });
      }
      if (m.type === 'material_set') console.log('material set');
      if (m.type === 'grid_set') console.log('grid set on worker');
      if (m.type === 'stepped') {
        // draw scaled grid
        const buf = new Uint16Array(m.grid);
        // expose last stepped grid for debugging
        try {
          (window as any).__lastGrid = buf.slice();
          (window as any).__lastGridWidth = m.width;
          const sampleIdx = 10* m.width + 10;
          (window as any).__lastGridSample = buf[sampleIdx];
          console.log('drawGrid sample [10,10] =', buf[sampleIdx], 'colorMap=', (window as any).__materialColors);
        } catch(e) {}
        drawGrid(buf, m.width, m.height);
      }
      if (m.type === 'error') console.warn('worker error', m.message);
    }
    worker.postMessage({type:'init', width:150, height:100});
  }
  const materialId = ++nextMaterialId;
  currentMaterialId = materialId;
  (window as any).__currentMaterialId = currentMaterialId;

  worker.postMessage({type:'set_material', material:mat, materialId});
  // set material color for rendering (accept hex string or [r,g,b] array)
  try {
    let color = [255,255,255];
    if (mat && mat.color) {
      if (typeof mat.color === 'string' && mat.color.startsWith('#')) {
        const hex = mat.color.replace('#','');
        color = [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
      } else if (Array.isArray(mat.color) && mat.color.length >= 3) {
        color = [mat.color[0], mat.color[1], mat.color[2]];
      }
    }
    const colorMap = (window as any).__materialColors || {};
    colorMap[materialId] = color;
    (window as any).__materialColors = colorMap;
    (window as any).__currentMaterialColor = color;
  } catch (e) {
    const colorMap = (window as any).__materialColors || {};
    colorMap[materialId] = [255,255,255];
    (window as any).__materialColors = colorMap;
    (window as any).__currentMaterialColor = [255,255,255];
  }

  // expose a simple helper to paint points for e2e tests
  (window as any).__paintGridPoints = (points:{x:number,y:number}[]) => {
    const id = (window as any).__currentMaterialId || 1;
    worker!.postMessage({type:'paint_points', materialId: id, points});
    // step so the new grid renders immediately
    worker!.postMessage({type:'step'});
  }
  // kick a step to test
  worker.postMessage({type:'step'});
}
// make init helper available to the page before it's called so other UI components
// (like the materials browser) can use it even before a material is set
(window as any).__initWorkerWithMaterial = initWorkerWithMaterial;

function drawGrid(buf:Uint16Array, w:number, h:number) {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // create an offscreen canvas for the small grid
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const offCtx = off.getContext('2d')!;
  // avoid smoothing when scaling so colors stay crisp
  try { offCtx.imageSmoothingEnabled = false; } catch(e) {}
  const img = offCtx.createImageData(w, h);
  // colorize using current material color if available, otherwise grayscale
  const colorMap = (window as any).__materialColors as Record<number, number[]> | undefined;
  for (let i=0;i<w*h;i++) {
    const v = buf[i] & 0xffff;
    const c = (v > 0 && colorMap) ? colorMap[v] : undefined;
    if (v > 0 && c) {
      img.data[i*4+0] = c[0];
      img.data[i*4+1] = c[1];
      img.data[i*4+2] = c[2];
      img.data[i*4+3] = 255;
    } else {
      img.data[i*4+0] = v;
      img.data[i*4+1] = v;
      img.data[i*4+2] = v;
      img.data[i*4+3] = 255;
    }
  }
  offCtx.putImageData(img,0,0);
  // draw scaled to main canvas using physical pixel size
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(off, 0,0, canvas.width, canvas.height);
}