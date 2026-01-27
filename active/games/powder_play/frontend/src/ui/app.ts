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
  import('./canvas_tools').then(mod => {
    mod.attachCanvasTools(canvas, (window as any).__powderWorker || null, 150, 100);
  });

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

let worker: Worker | null = null;
function initWorkerWithMaterial(mat:any) {
  if (!worker) {
    // worker script lives at the project-level `sim/worker.ts`, so go up one more dir
    worker = new Worker(new URL('../../../sim/worker.ts', import.meta.url), { type: 'module' });
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
        drawGrid(buf, m.width, m.height, 600, 400);
      }
      if (m.type === 'error') console.warn('worker error', m.message);
    }
    worker.postMessage({type:'init', width:150, height:100});
  }
  worker.postMessage({type:'set_material', material:mat});
  // expose a simple helper to paint points for e2e tests
  (window as any).__paintGridPoints = (points:{x:number,y:number}[]) => {
    const buf = new Uint16Array(150*100);
    for (const p of points) {
      const idx = p.y*150 + p.x;
      if (idx>=0 && idx < buf.length) buf[idx] = 255;
    }
    worker!.postMessage({type:'set_grid', buffer: buf.buffer}, [buf.buffer]);
  }
  // kick a step to test
  worker.postMessage({type:'step'});
}
// make init helper available to the page before it's called so other UI components
// (like the materials browser) can use it even before a material is set
(window as any).__initWorkerWithMaterial = initWorkerWithMaterial;

function drawGrid(buf:Uint16Array, w:number, h:number, canvasW:number, canvasH:number) {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  // create an offscreen canvas for the small grid
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const offCtx = off.getContext('2d')!;
  const img = offCtx.createImageData(w, h);
  for (let i=0;i<w*h;i++) {
    const v = buf[i] & 0xff;
    img.data[i*4+0] = v;
    img.data[i*4+1] = v;
    img.data[i*4+2] = v;
    img.data[i*4+3] = 255;
  }
  offCtx.putImageData(img,0,0);
  // draw scaled to main canvas
  ctx.clearRect(0,0,canvasW,canvasH);
  ctx.drawImage(off, 0,0, canvasW, canvasH);
}