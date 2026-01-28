export function attachCanvasTools(canvas: HTMLCanvasElement, worker: Worker | null, gridW: number, gridH: number, toolsRoot: HTMLElement) {
  if ((toolsRoot as any).dataset?.toolsMounted === 'true') return;
  (toolsRoot as any).dataset.toolsMounted = 'true';
  const info = document.createElement('div');
  // add clear and brush-size controls
  info.innerHTML = `<button id="clear-grid">Clear</button> <label>Brush <select id="brush-size"><option value="1">Small</option><option value="3">Medium</option><option value="5">Large</option></select></label> <label><input type="checkbox" id="eraser-toggle"> Eraser</label> <span id="paint-mode">Paint</span>`;
  toolsRoot.appendChild(info);

  const clearBtn = info.querySelector('#clear-grid') as HTMLButtonElement;
  const brushSel = info.querySelector('#brush-size') as HTMLSelectElement;
  const eraserToggle = info.querySelector('#eraser-toggle') as HTMLInputElement;
  const paintMode = info.querySelector('#paint-mode') as HTMLSpanElement;

  let drawing = false;
  const strokePoints = new Set<string>();
  let brushRadius = parseInt(brushSel.value, 10); // in grid cells radius

  brushSel.onchange = () => {
    brushRadius = parseInt(brushSel.value, 10);
  }
  eraserToggle.onchange = () => {
    paintMode.textContent = eraserToggle.checked ? 'Erase' : 'Paint';
  }

  // overlay canvas for cursor preview
  const parent = canvas.parentElement as HTMLElement;
  if (parent) parent.style.position = parent.style.position || 'relative';
  const overlay = document.createElement('canvas');
  // match overlay to canvas physical pixels
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlay.style.width = canvas.style.width;
  overlay.style.height = canvas.style.height;
  overlay.style.position = 'absolute';
  overlay.style.left = canvas.offsetLeft + 'px';
  overlay.style.top = canvas.offsetTop + 'px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '10';
  parent.appendChild(overlay);
  const octx = overlay.getContext('2d')!;
  // avoid smoothing on overlay
  try { octx.imageSmoothingEnabled = false; } catch (e) {}
  // account for DPR by scaling drawing into overlay if needed
  try {
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== 1) {
      octx.setTransform(dpr,0,0,dpr,0,0);
    }
  } catch (e) {};

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
        if (nx>=0 && nx<gridW && ny>=0 && ny<gridH) strokePoints.add(`${nx},${ny}`);
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

  const pendingPaints: { materialId:number, points:{x:number,y:number}[] }[] = [];
  let currentWorker = worker;
  const flushPending = () => {
    const w = (window as any).__powderWorker as Worker | undefined;
    if (w && !currentWorker) {
      currentWorker = w;
    }
    if (currentWorker && pendingPaints.length) {
      for (const p of pendingPaints) {
        currentWorker.postMessage({type:'paint_points', materialId: p.materialId, points: p.points});
        currentWorker.postMessage({type:'step'});
      }
      pendingPaints.length = 0;
    }
  };
  const flushIv = setInterval(flushPending, 500);

  // wire clear button now that queueing is available
  clearBtn.onclick = () => {
    const buf = new Uint16Array(gridW*gridH);
    if (currentWorker) {
      currentWorker.postMessage({type:'set_grid', buffer: buf.buffer});
      currentWorker.postMessage({type:'step'});
    } else {
      pendingPaints.push({ materialId: 0, points: [] });
    }
    // also clear overlay
    try { octx.clearRect(0,0,overlay.width, overlay.height); } catch (e) {}
  }

  window.addEventListener('mouseup', ()=>{
    if (!drawing) return;
    drawing = false;
    // send grid to worker (or queue if worker not available yet)
    const id = eraserToggle.checked ? 0 : ((window as any).__currentMaterialId || 1);
    const points = Array.from(strokePoints).map((s) => {
      const [x,y] = s.split(',').map(Number);
      return {x,y};
    });
    strokePoints.clear();
    if (currentWorker) {
      currentWorker.postMessage({type:'paint_points', materialId: id, points});
      // immediately step one tick so paint is visible without pressing Step
      currentWorker.postMessage({type:'step'});
    } else {
      pendingPaints.push({ materialId: id, points });
    }
  });
}