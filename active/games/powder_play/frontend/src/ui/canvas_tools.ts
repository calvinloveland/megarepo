export function attachCanvasTools(canvas: HTMLCanvasElement, worker: Worker | null, gridW: number, gridH: number, toolsRoot: HTMLElement) {
  if ((toolsRoot as any).dataset?.toolsMounted === 'true') return;
  (toolsRoot as any).dataset.toolsMounted = 'true';
  const info = document.createElement('div');
  // add clear and brush-size controls
  info.innerHTML = `
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <button id="clear-grid" class="alchemy-button">Clear</button>
        <button id="clear-recover" class="alchemy-button">Clear + Recover</button>
        <label class="alchemy-label flex items-center gap-2">Brush
          <select id="brush-size" class="alchemy-select">
            <option value="1">Small</option>
            <option value="3">Medium</option>
            <option value="5">Large</option>
          </select>
        </label>
        <label class="alchemy-label flex items-center gap-2"><input type="checkbox" id="eraser-toggle" class="accent-amber-500"> Drain</label>
        <span id="paint-mode" class="alchemy-muted">Source</span>
      </div>
    </div>
  `;
  toolsRoot.appendChild(info);

  const clearBtn = info.querySelector('#clear-grid') as HTMLButtonElement;
  const clearRecoverBtn = info.querySelector('#clear-recover') as HTMLButtonElement;
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
    paintMode.textContent = eraserToggle.checked ? 'Drain' : 'Source';
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

  // ── Touch event handlers (mobile) ──
  function touchToClient(ev: TouchEvent) {
    const t = ev.touches?.[0] || ev.changedTouches?.[0];
    return t ? { clientX: t.clientX, clientY: t.clientY } : null;
  }

  canvas.addEventListener('touchstart', (ev: TouchEvent) => {
    ev.preventDefault();
    const c = touchToClient(ev);
    if (!c) return;
    drawing = true;
    const p = toGridPosFromClient(c.clientX, c.clientY);
    if (p.x >= 0 && p.x < gridW && p.y >= 0 && p.y < gridH) paintAt(p.x, p.y);
  }, { passive: false });

  canvas.addEventListener('touchmove', (ev: TouchEvent) => {
    ev.preventDefault();
    const c = touchToClient(ev);
    if (!c) return;
    // Update overlay cursor
    const p = toGridPosFromClient(c.clientX, c.clientY);
    const pxPerCell = overlay.width / gridW;
    const cx = Math.floor((p.x + 0.5) * pxPerCell);
    const cy = Math.floor((p.y + 0.5) * (overlay.height / gridH));
    const rpx = Math.ceil(brushRadius * pxPerCell);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.beginPath();
    octx.strokeStyle = 'rgba(255,255,255,0.9)';
    octx.lineWidth = 1;
    octx.arc(cx, cy, rpx, 0, Math.PI * 2);
    octx.stroke();

    if (!drawing) return;
    if (p.x >= 0 && p.x < gridW && p.y >= 0 && p.y < gridH) paintAt(p.x, p.y);
  }, { passive: false });

  canvas.addEventListener('touchend', (ev: TouchEvent) => {
    ev.preventDefault();
    finishStroke();
  }, { passive: false });

  canvas.addEventListener('touchcancel', () => {
    finishStroke();
  });

  const pendingPaints: { materialId:number, points:{x:number,y:number}[] }[] = [];
  let pendingClear = false;
  let currentWorker = worker;
  const sendClearGrid = () => {
    const buf = new Uint16Array(gridW * gridH);
    const airId = (window as any).__ambientMaterialId || 0;
    if (airId) buf.fill(airId);
    pendingPaints.length = 0;
    if (currentWorker) {
      currentWorker.postMessage({ type:'set_grid', buffer: buf.buffer });
      currentWorker.postMessage({ type:'step' });
      pendingClear = false;
    } else {
      pendingClear = true;
    }
    try { octx.clearRect(0,0,overlay.width, overlay.height); } catch (e) {}
  };
  const flushPending = () => {
    const w = (window as any).__powderWorker as Worker | undefined;
    if (w && !currentWorker) {
      currentWorker = w;
    }
    if (currentWorker && pendingClear) {
      sendClearGrid();
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
    sendClearGrid();
    const status = document.getElementById('status');
    if (status) status.textContent = 'Board cleared';
  }

  // Clear + Recover: clear grid AND recover all placed materials back to supply.
  // This does NOT reset discovered pairs or progression.
  clearRecoverBtn.onclick = () => {
    // Recover all materials currently on the grid
    const lastGrid = (window as any).__lastGrid as Uint16Array | undefined;
    const lastGridW = (window as any).__lastGridWidth as number | undefined;
    const nameById = (window as any).__materialIdByName as Record<string, number> | undefined;
    const supplyMap = (window as any).__materialSupply as Map<string, number> | undefined;

    if (lastGrid && lastGridW && nameById && supplyMap) {
      const idToName: Record<number, string> = {};
      for (const [name, id] of Object.entries(nameById)) {
        idToName[id as number] = name;
      }

      const recovered = new Map<string, number>();
      for (let i = 0; i < lastGrid.length; i++) {
        const cellId = lastGrid[i];
        if (cellId > 0) {
          const matName = idToName[cellId];
          if (matName) {
            const supply = supplyMap.get(matName);
            if (supply !== undefined && supply !== Infinity && supply !== null) {
              recovered.set(matName, (recovered.get(matName) || 0) + 1);
            }
          }
        }
      }

      let totalRecovered = 0;
      for (const [name, amount] of recovered) {
        const current = supplyMap.get(name) || 0;
        supplyMap.set(name, current + amount);
        totalRecovered += amount;
      }
      (window as any).__materialSupply = supplyMap;

      const status = document.getElementById('status');
      if (status) status.textContent = `Recovered ${totalRecovered} units and cleared the board`;
    }

    try {
      (window as any).__refreshSupplyDisplay?.();
    } catch (e) {}

    sendClearGrid();
  }

  function finishStroke() {
    if (!drawing) return;
    drawing = false;

    const points = Array.from(strokePoints).map((s) => {
      const [x,y] = s.split(',').map(Number);
      return {x,y};
    });
    strokePoints.clear();
    if (!points.length) return;

    const status = document.getElementById('status');
    let materialId: number | null = null;

    if (eraserToggle.checked) {
      materialId = (window as any).__drainMaterialId || (window as any).__materialIdByName?.Drain || null;
      if (!materialId) {
        if (status) status.textContent = 'Drain tool is not ready yet.';
        return;
      }
      if (status) status.textContent = `Placed ${points.length} drain${points.length === 1 ? '' : 's'}`;
    } else {
      const selectedId = (window as any).__currentMaterialId || 1;
      const nameById: Record<string, number> | undefined = (window as any).__materialIdByName;
      let matName: string | undefined;
      if (nameById) {
        for (const [name, mid] of Object.entries(nameById)) {
          if (mid === selectedId) { matName = name; break; }
        }
      }
      if (!matName) {
        if (status) status.textContent = 'Select a material to configure the source.';
        return;
      }
      const sourceId = (window as any).__ensureSourceToolMaterial?.(matName);
      if (!sourceId) {
        if (status) status.textContent = `Cannot create a source for ${matName}.`;
        return;
      }
      materialId = sourceId;
      if (status) status.textContent = `Placed ${matName} source${points.length === 1 ? '' : 's'}`;
    }

    if (currentWorker) {
      currentWorker.postMessage({type:'paint_points', materialId, points});
      currentWorker.postMessage({type:'step'});
    } else {
      pendingPaints.push({ materialId, points });
    }
  }

  window.addEventListener('mouseup', finishStroke);
  window.addEventListener('touchend', (ev: TouchEvent) => {
    // touchend on the canvas itself triggers finishStroke via the canvas listener.
    // This window listener handles the case where the finger leaves the canvas.
    finishStroke();
  });
}