export function mountMaterialBrowser(root: HTMLElement) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="space-y-2">
      <h3 class="text-lg">Materials</h3>
      <label class="alchemy-label flex items-center gap-2"><input type="checkbox" id="auto-load-materials" checked class="accent-amber-500"> Auto-load new materials</label>
      <label class="alchemy-label flex items-center gap-2"><input type="checkbox" id="show-all-materials" class="accent-amber-500"> Show all materials</label>
      <div id="materials-list" class="space-y-1 max-h-[420px] overflow-auto">(loading...)</div>
      <div id="discovered-section" class="space-y-1 hidden">
        <h4 class="text-sm text-amber-200/90">Discovered</h4>
        <div id="discovered-list" class="space-y-1"></div>
      </div>
    </div>
  `;
  root.appendChild(container);

  const listEl = container.querySelector('#materials-list') as HTMLElement;
  const discoveredSection = container.querySelector('#discovered-section') as HTMLElement;
  const discoveredList = container.querySelector('#discovered-list') as HTMLElement;
  const autoLoad = container.querySelector('#auto-load-materials') as HTMLInputElement;
  const showAll = container.querySelector('#show-all-materials') as HTMLInputElement;

  const discovered = new Set<string>();

  const starterNames = new Set(['Fire', 'Sand', 'Salt', 'Water']);

  let known = new Set<string>();
  let skipAutoLoadOnce = false;

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
    const visible = showAll.checked ? mats : mats.filter((m:any) => starterNames.has(m?.name));
    if (!visible.length) { listEl.textContent = '(no materials)'; return; }
    const sorted = visible.slice().sort((a:any, b:any) => {
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
      row.className = 'materials-row flex items-center justify-between gap-2 rounded-md border border-amber-900/30 bg-midnight/60 px-2 py-1';
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.innerHTML = `<div class="flex items-center gap-2"><span class="swatch" style="width:14px;height:14px;border:1px solid #222;background:transparent"></span><strong class="text-amber-100">${m.name}</strong> <small class="alchemy-muted">${m.file}</small></div>`;
      row.onclick = async () => { await loadMaterial(m.file); selectRowByName(m.name); };
      row.onkeydown = async (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); await loadMaterial(m.file); selectRowByName(m.name); } };
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
    const currentSet = new Set(visible.map((x:any)=>x.file));
    let added = null;
    for (const f of currentSet) if (!known.has(f)) { added = f; break; }
    known = currentSet;
    if (added && autoLoad.checked && !skipAutoLoadOnce) {
      console.log('[material_browser] detected added:', added);
      // find the material entry that was added and load it specifically
      const addedMat = visible.find((mm:any)=>mm.file === added);
      if (addedMat) {
        console.log('[material_browser] loading added:', addedMat.file);
        await loadMaterial(addedMat.file);
        selectRowByName(addedMat.name);
      }
    }
    skipAutoLoadOnce = false;
  }
  function selectRowByName(name:string) {
    const rows = Array.from(listEl.querySelectorAll('.materials-row')) as HTMLElement[];
    for (const r of rows) {
      const strong = r.querySelector('strong');
      if (strong && strong.textContent === name) r.classList.add('selected');
      else r.classList.remove('selected');
    }
    const drows = Array.from(discoveredList.querySelectorAll('.materials-row')) as HTMLElement[];
    for (const r of drows) {
      const strong = r.querySelector('strong');
      if (strong && strong.textContent === name) r.classList.add('selected');
      else r.classList.remove('selected');
    }
  }

  function addDiscoveredMaterial(mat:any) {
    if (!mat?.name || discovered.has(mat.name)) return;
    discovered.add(mat.name);
    discoveredSection.classList.remove('hidden');
    const row = document.createElement('div');
    row.className = 'materials-row flex items-center justify-between gap-2 rounded-md border border-amber-900/30 bg-midnight/60 px-2 py-1';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.innerHTML = `<div class="flex items-center gap-2"><span class="swatch" style="width:14px;height:14px;border:1px solid #222;background:transparent"></span><strong class="text-amber-100">${mat.name}</strong> <small class="alchemy-muted">runtime</small></div>`;
    const sw = row.querySelector('.swatch') as HTMLElement;
    if (Array.isArray(mat.color)) sw.style.background = `rgb(${mat.color[0]},${mat.color[1]},${mat.color[2]})`;
    row.onclick = () => {
      try { (window as any).__selectMaterialByName?.(mat.name); } catch (e) {}
      selectRowByName(mat.name);
    };
    row.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        try { (window as any).__selectMaterialByName?.(mat.name); } catch (e) {}
        selectRowByName(mat.name);
      }
    };
    discoveredList.appendChild(row);
  }
  async function loadMaterial(file:string) {
    try {
      const r = await fetch(`/materials/${file}`);
      if (!r.ok) return;
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
        await ensureReactionMaterials(mat);
      } else {
        console.warn('initWorkerWithMaterial not available');
      }
    } catch (e) { console.warn('load material failed', e); }
  }

  async function ensureReactionMaterials(mat:any) {
    try {
      const needed = new Set<string>();
      if (Array.isArray(mat?.reactions)) {
        for (const r of mat.reactions) {
          if (r?.result) needed.add(r.result);
          if (r?.byproduct) needed.add(r.byproduct);
        }
      }
      if (mat?.condense?.result) needed.add(mat.condense.result);
      if (!needed.size) return;
      const idxResp = await fetch('/materials/index.json', { cache: 'no-store' });
      if (!idxResp.ok) return;
      const idx = await idxResp.json();
      const list = Array.isArray(idx?.materials) ? idx.materials : [];
      const nameToFile = new Map<string, string>();
      for (const entry of list) {
        if (entry?.name && entry?.file) nameToFile.set(entry.name, entry.file);
      }
      const known = (window as any).__materialIdByName || {};
      for (const name of needed) {
        if (known[name]) continue;
        const depFile = nameToFile.get(name);
        if (!depFile) continue;
        const depResp = await fetch(`/materials/${depFile}`);
        if (!depResp.ok) continue;
        const depMat = await depResp.json();
        if ((window as any).__registerMaterial) {
          (window as any).__registerMaterial(depMat);
        }
      }
    } catch (e) {
      console.warn('ensureReactionMaterials failed', e);
    }
  }

  showAll.onchange = () => {
    skipAutoLoadOnce = true;
    refresh();
  };

  // initial fetch
  refresh();
  // poll
  const iv = setInterval(refresh, 2000);

  try {
    (window as any).__addDiscoveredMaterial = addDiscoveredMaterial;
  } catch (e) {}
  try {
    const existing = (window as any).__discoveredMaterials || [];
    if (Array.isArray(existing)) {
      for (const mat of existing) addDiscoveredMaterial(mat);
    }
  } catch (e) {}

  // expose cleanup (not used yet)
  return () => clearInterval(iv);
}
