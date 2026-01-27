export function attachCanvasTools(canvas: HTMLCanvasElement, worker: Worker | null, gridW: number, gridH: number) {
  const btns = document.getElementById('controls')!;
  const info = document.createElement('div');
  // add clear and brush-size controls
  info.innerHTML = `<button id="clear-grid">Clear</button> <label>Brush <select id="brush-size"><option value="1">Small</option><option value="3">Medium</option><option value="5">Large</option></select></label> <span id="paint-mode">Paint</span>`;
  btns.appendChild(info);

  const clearBtn = info.querySelector('#clear-grid') as HTMLButtonElement;
  const brushSel = info.querySelector('#brush-size') as HTMLSelectElement;

  let drawing = false;
  // we maintain a local grid buffer to accumulate strokes until mouseup
  const grid = new Uint16Array(gridW*gridH);
  let brushRadius = parseInt(brushSel.value, 10); // in grid cells radius

  brushSel.onchange = () => {
    brushRadius = parseInt(brushSel.value, 10);
  }

  // overlay canvas for cursor preview
  const parent = canvas.parentElement as HTMLElement;
  if (parent) parent.style.position = parent.style.position || 'relative';
  const overlay = document.createElement('canvas');
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlay.style.position = 'absolute';
  overlay.style.left = canvas.offsetLeft + 'px';
  overlay.style.top = canvas.offsetTop + 'px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '10';
  parent.appendChild(overlay);
  const octx = overlay.getContext('2d')!;

  function toGridPosFromClient(clientX:number, clientY:number) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / rect.width * gridW);
    const y = Math.floor((clientY - rect.top) / rect.height * gridH);
    return {x,y, rect};
  }

  function paintAt(gridX:number, gridY:number) {
    const r = brushRadius;
    const r2 = r*r;
    for (let dy=-r; dy<=r; dy++) {
      for (let dx=-r; dx<=r; dx++) {
        if (dx*dx + dy*dy > r2) continue;
        const nx = gridX + dx, ny = gridY + dy;
        if (nx>=0 && nx<gridW && ny>=0 && ny<gridH) grid[ny*gridW + nx] = 255;
      }
    }
  }

  canvas.addEventListener('mousedown', (ev)=>{
    drawing = true;
    const p = toGridPosFromClient(ev.clientX, ev.clientY);
    if (p.x>=0 && p.x<gridW && p.y>=0 && p.y<gridH) paintAt(p.x, p.y);
  });
  canvas.addEventListener('mousemove', (ev)=>{
    // update overlay cursor
    const p = toGridPosFromClient(ev.clientX, ev.clientY);
    // draw cursor circle scaled to canvas pixels
    const pxPerCell = overlay.width / gridW;
    const cx = Math.floor((p.x + 0.5) * pxPerCell);
    const cy = Math.floor((p.y + 0.5) * (overlay.height / gridH));
    const rpx = Math.ceil(brushRadius * pxPerCell);
    octx.clearRect(0,0,overlay.width, overlay.height);
    octx.beginPath();
    octx.strokeStyle = 'rgba(255,255,255,0.9)';
    octx.lineWidth = 1;
    octx.arc(cx, cy, rpx, 0, Math.PI*2);
    octx.stroke();

    if (!drawing) return;
    if (p.x>=0 && p.x<gridW && p.y>=0 && p.y<gridH) paintAt(p.x, p.y);
  });
  canvas.addEventListener('mouseleave', ()=>{ octx.clearRect(0,0,overlay.width, overlay.height); });

  const pendingBuffers: ArrayBuffer[] = [];
  let currentWorker = worker;
  const flushPending = () => {
    const w = (window as any).__powderWorker as Worker | undefined;
    if (w && !currentWorker) {
      currentWorker = w;
    }
    if (currentWorker && pendingBuffers.length) {
      for (const b of pendingBuffers) {
        currentWorker.postMessage({type:'set_grid', buffer: b}, [b]);
        currentWorker.postMessage({type:'step'});
      }
      pendingBuffers.length = 0;
    }
  };
  const flushIv = setInterval(flushPending, 500);

  // wire clear button now that queueing is available
  clearBtn.onclick = () => {
    const buf = new Uint16Array(gridW*gridH);
    if (currentWorker) {
      currentWorker.postMessage({type:'set_grid', buffer: buf.buffer}, [buf.buffer]);
      currentWorker.postMessage({type:'step'});
    } else {
      pendingBuffers.push(buf.buffer);
    }
    // also clear overlay
    try { octx.clearRect(0,0,overlay.width, overlay.height); } catch (e) {}
  }

  window.addEventListener('mouseup', ()=>{
    if (!drawing) return;
    drawing = false;
    // send grid to worker (or queue if worker not available yet)
    if (currentWorker) {
      currentWorker.postMessage({type:'set_grid', buffer: grid.buffer}, [grid.buffer]);
      // immediately step one tick so paint is visible without pressing Step
      currentWorker.postMessage({type:'step'});
    } else {
      pendingBuffers.push(grid.buffer);
    }
    // recreate grid since buffer was transferred or queued
    for (let i=0;i<grid.length;i++) grid[i]=0;
  });
}