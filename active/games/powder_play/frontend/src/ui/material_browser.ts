export function mountMaterialBrowser(root: HTMLElement) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div>
      <h3>Materials</h3>
      <label><input type="checkbox" id="auto-load-materials" checked> Auto-load new materials</label>
      <div id="materials-list">(loading...)</div>
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
    // render list
    listEl.innerHTML = '';
    let newest = null;
    for (const m of mats) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.padding = '2px 0';
      row.innerHTML = `<div><strong>${m.name}</strong> <small style=\"opacity:.7\">${m.file}</small></div><div><button class=\"load\">Load</button></div>`;
      const btn = row.querySelector('.load') as HTMLButtonElement;
      btn.onclick = async () => {
        await loadMaterial(m.file);
      };
      listEl.appendChild(row);
      newest = m;
    }
    // detect newly added
    const currentSet = new Set(mats.map(x=>x.file));
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
