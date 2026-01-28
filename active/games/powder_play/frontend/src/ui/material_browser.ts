export function mountMaterialBrowser(root: HTMLElement) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="space-y-2">
      <h3 class="text-lg">Materials</h3>
      <label class="alchemy-label flex items-center gap-2"><input type="checkbox" id="auto-load-materials" checked class="accent-amber-500"> Auto-load new materials</label>
      <div id="materials-list" class="space-y-1 max-h-[420px] overflow-auto">(loading...)</div>
    </div>
  `;
  root.appendChild(container);

  const listEl = container.querySelector('#materials-list') as HTMLElement;
  const autoLoad = container.querySelector('#auto-load-materials') as HTMLInputElement;

  let known = new Set<string>();

  async function fetchIndex() {
    try {
      const r = await fetch('/materials/index.json', {cache:'no-store'});
      if (!r.ok) { listEl.textContent = '(no materials)'; return []; }
      const j = await r.json();
      return j.materials || [];
    } catch (e) { listEl.textContent = '(materials unavailable)'; return []; }
  }

  async function refresh() {
    const mats = await fetchIndex();
    if (!mats.length) { listEl.textContent = '(no materials)'; return; }
    const sorted = mats.slice().sort((a:any, b:any) => {
      const aKey = String(a?.name || a?.file || '').toLowerCase();
      const bKey = String(b?.name || b?.file || '').toLowerCase();
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      return 0;
    });
    // render list
    listEl.innerHTML = '';
    let newest = null;
    function colorFromName(name:string) {
      let h = 0;
      for (let i=0;i<name.length;i++) h = ((h<<5)-h + name.charCodeAt(i)) | 0;
      const seed = Math.abs(h);
      const r = 60 + (seed % 180);
      const g = 60 + ((seed >> 8) % 180);
      const b = 60 + ((seed >> 16) % 180);
      return [r,g,b];
    }
    for (const m of sorted) {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 rounded-md border border-amber-900/30 bg-midnight/60 px-2 py-1';
      row.innerHTML = `<div class="flex items-center gap-2"><span class="swatch" style="width:14px;height:14px;border:1px solid #222;background:transparent"></span><strong class="text-amber-100">${m.name}</strong> <small class="alchemy-muted">${m.file}</small></div><div><button class="load alchemy-button">Load</button></div>`;
      const btn = row.querySelector('.load') as HTMLButtonElement;
      btn.onclick = async () => {
        await loadMaterial(m.file);
      };
      // fetch material to show color swatch
      (async () => {
        try {
          const r = await fetch(`/materials/${m.file}`);
          if (!r.ok) return;
          const mt = await r.json();
          const sw = row.querySelector('.swatch') as HTMLElement;
          const c = Array.isArray(mt?.color) ? mt.color : null;
          const color = c || colorFromName(mt?.name || m.name || 'material');
          sw.style.background = `rgb(${color[0]},${color[1]},${color[2]})`;
        } catch (e) {}
      })();
      listEl.appendChild(row);
      newest = m;
    }
    // detect newly added
    const currentSet = new Set(mats.map((x:any)=>x.file));
    let added = null;
    for (const f of currentSet) if (!known.has(f)) { added = f; break; }
    known = currentSet;
    if (added && autoLoad.checked) {
      console.log('[material_browser] detected added:', added);
      // find the material entry that was added and load it specifically
      const addedMat = mats.find((mm:any)=>mm.file === added);
      if (addedMat) {
        console.log('[material_browser] loading added:', addedMat.file);
        await loadMaterial(addedMat.file);
      }
    }
  }

  async function loadMaterial(file:string) {
    try {
      const r = await fetch(`/materials/${file}`);
      const mat = await r.json();
      // sanity check
      if (mat.type !== 'material' || !mat.name || !mat.primitives) {
        console.warn('Invalid material', file);
        return;
      }
      // use the exposed helper to init worker
      if ((window as any).__initWorkerWithMaterial) {
        console.log('[material_browser] initWorkerWithMaterial ->', mat.name, file);
        (window as any).__initWorkerWithMaterial(mat);
        const status = document.getElementById('status');
        if (status) status.textContent = `Material ready: ${mat.name}`;
        // notify test harnesss or external listeners that a material was loaded
        try {
          const cb = (window as any).onMaterialLoaded;
          if (typeof cb === 'function') cb(mat.name, file);
        } catch (err) {
          // ignore
        }
      } else {
        console.warn('initWorkerWithMaterial not available');
      }
    } catch (e) { console.warn('load material failed', e); }
  }

  // initial fetch
  refresh();
  // poll
  const iv = setInterval(refresh, 2000);

  // expose cleanup (not used yet)
  return () => clearInterval(iv);
}
