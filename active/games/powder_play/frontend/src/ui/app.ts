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

  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

let worker: Worker | null = null;
function initWorkerWithMaterial(mat:any) {
  if (!worker) {
    worker = new Worker(new URL('../../sim/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') console.log('worker ready');
      if (m.type === 'material_set') console.log('material set');
      if (m.type === 'stepped') {
        // TODO: draw grid
        const buf = new Uint16Array(m.grid);
        drawGrid(buf, 600, 400);
      }
    }
    worker.postMessage({type:'init', width:150, height:100});
  }
  worker.postMessage({type:'set_material', material:mat});
  // kick a step to test
  worker.postMessage({type:'step'});
}

function drawGrid(buf:Uint16Array, w:number, h:number) {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i=0;i<w*h;i++) {
    const v = buf[i] & 0xff;
    img.data[i*4+0] = v;
    img.data[i*4+1] = v;
    img.data[i*4+2] = v;
    img.data[i*4+3] = 255;
  }
  ctx.putImageData(img,0,0);
}