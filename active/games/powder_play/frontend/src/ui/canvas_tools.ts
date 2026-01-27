export function attachCanvasTools(canvas: HTMLCanvasElement, worker: Worker, gridW: number, gridH: number) {
  const btns = document.getElementById('controls')!;
  const info = document.createElement('div');
  info.innerHTML = `<button id="clear-grid">Clear</button> <span id="paint-mode">Paint</span>`;
  btns.appendChild(info);

  const clearBtn = info.querySelector('#clear-grid') as HTMLButtonElement;
  clearBtn.onclick = () => {
    const buf = new Uint16Array(gridW*gridH);
    worker.postMessage({type:'set_grid', buffer: buf.buffer}, [buf.buffer]);
  }

  let drawing = false;
  const grid = new Uint16Array(gridW*gridH);

  function toGridPos(ev: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) / rect.width * gridW);
    const y = Math.floor((ev.clientY - rect.top) / rect.height * gridH);
    return {x,y};
  }

  canvas.addEventListener('mousedown', (ev)=>{
    drawing = true;
    const p = toGridPos(ev);
    if (p.x>=0 && p.x<gridW && p.y>=0 && p.y<gridH) grid[p.y*gridW + p.x] = 255;
  });
  canvas.addEventListener('mousemove', (ev)=>{
    if (!drawing) return;
    const p = toGridPos(ev);
    if (p.x>=0 && p.x<gridW && p.y>=0 && p.y<gridH) grid[p.y*gridW + p.x] = 255;
  });
  window.addEventListener('mouseup', ()=>{
    if (!drawing) return;
    drawing = false;
    // send grid to worker
    worker.postMessage({type:'set_grid', buffer: grid.buffer}, [grid.buffer]);
    // recreate grid since buffer was transferred
    for (let i=0;i<grid.length;i++) grid[i]=0;
  });
}