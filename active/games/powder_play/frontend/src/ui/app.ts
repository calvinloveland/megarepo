import { runLocalLLM } from '../material_api';

export function initApp(root: HTMLElement) {
  root.className = 'min-h-screen w-full p-4';
  root.innerHTML = `
    <div class="flex flex-col lg:flex-row gap-4 items-start">
      <div id="left-panel" class="alchemy-panel min-w-[220px] w-full lg:w-64">
        <h1 class="text-2xl">Alchemist Powder</h1>
        <div id="materials-panel"></div>
        <div id="status" class="alchemy-muted"></div>
      </div>
      <div id="center-panel" class="flex flex-col items-center gap-2 w-full">
        <div id="mix-banner" class="alchemy-panel w-full text-amber-200 hidden">New material discovered! Generating...</div>
        <div class="alchemy-panel w-full flex justify-center">
          <canvas id="sim-canvas" width="600" height="400" class="border border-amber-700/40 rounded-md"></canvas>
        </div>
        <div id="playback-controls" class="alchemy-panel"></div>
      </div>
      <div id="right-panel" class="alchemy-panel min-w-[220px] w-full lg:w-64">
        <h3 class="text-lg">Tools</h3>
        <div id="tools-panel" class="space-y-2"></div>
      </div>
    </div>
  `;

  const status = document.getElementById('status')!;
  status.textContent = 'Ready';

  const materialsPanel = document.getElementById('materials-panel')!;
  const playbackControls = document.getElementById('playback-controls')!;
  const toolsPanel = document.getElementById('tools-panel')!;

  // mount materials browser
  import('./material_browser').then(m => {
    m.mountMaterialBrowser(materialsPanel);
  });

  // attach play/step controls
  import('./controls').then(mod => {
    mod.attachControls(playbackControls, (playingOrStep:boolean)=>{
      // playingOrStep true for a tick, false for pause action
      if (!worker) return;
      if (mixBlocked) return;
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
    mod.attachCanvasTools(canvas, (window as any).__powderWorker || null, 150, 100, toolsPanel);
  });

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);
}

let worker: Worker | null = null;
let nextMaterialId = 0;
let currentMaterialId = 0;
const materialById = new Map<number, any>();
const materialIdByName = new Map<string, number>();
const autoMixPairs = new Set<string>();
const mixCache = new Map<string, any>();
const pendingMixes = new Set<string>();
const mixCacheStorageKey = 'alchemistPowder.mixCache.v2';
const mixCacheVersionKey = 'alchemistPowder.mixCache.version';
const mixCacheVersion = 'v2';
const mixApiBase = (window as any).__mixApiBase || 'http://127.0.0.1:8787';
let mixBlocked = false;

function mixCacheKey(aName:string, bName:string) {
  return [aName, bName].sort().join('|');
}

function setMixBlocked(blocked:boolean, message?:string) {
  mixBlocked = blocked;
  try { (window as any).__mixBlocked = blocked; } catch (e) {}
  const banner = document.getElementById('mix-banner');
  if (banner) {
    banner.classList.toggle('hidden', !blocked);
    if (blocked && message) banner.textContent = message;
    if (!blocked) banner.textContent = 'New material discovered! Generating...';
  }
}

async function loadMixCacheFromServer() {
  try {
    const res = await fetch(`${mixApiBase}/mixes`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`mix cache fetch failed: ${res.status}`);
    const parsed = await res.json() as Record<string, any>;
    for (const [key, value] of Object.entries(parsed || {})) {
      mixCache.set(key, value);
    }
  } catch (e) {
    console.warn('mix cache load failed', e);
    loadMixCacheFromLocal();
  }
}

async function clearMixCacheOnServer() {
  try {
    await fetch(`${mixApiBase}/mixes`, { method: 'DELETE' });
  } catch (e) {
    console.warn('mix cache clear failed', e);
  }
}

function loadMixCacheFromLocal() {
  try {
    const raw = localStorage.getItem(mixCacheStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, any>;
    for (const [key, value] of Object.entries(parsed)) {
      mixCache.set(key, value);
    }
  } catch (e) {
    console.warn('mix cache local load failed', e);
  }
}

function clearMixCacheLocal() {
  try {
    localStorage.removeItem(mixCacheStorageKey);
  } catch (e) {
    console.warn('mix cache local clear failed', e);
  }
  mixCache.clear();
}

function saveMixCacheToLocal() {
  try {
    const out: Record<string, any> = {};
    for (const [key, value] of mixCache.entries()) {
      out[key] = value;
    }
    localStorage.setItem(mixCacheStorageKey, JSON.stringify(out));
  } catch (e) {
    console.warn('mix cache local save failed', e);
  }
}

async function fetchMixFromServer(cacheKey:string) {
  try {
    const res = await fetch(`${mixApiBase}/mixes/${encodeURIComponent(cacheKey)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`mix fetch failed: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('mix fetch failed', e);
    return null;
  }
}

async function saveMixToServer(cacheKey:string, mix:any) {
  try {
    const res = await fetch(`${mixApiBase}/mixes/${encodeURIComponent(cacheKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mix)
    });
    if (!res.ok) throw new Error(`mix save failed: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('mix save failed', e);
    return null;
  }
}

function stripTransientFields(mat:any) {
  if (!mat || typeof mat !== 'object') return mat;
  const clone = JSON.parse(JSON.stringify(mat));
  delete clone.__compiled;
  return clone;
}

function isNoReactionPayload(mix:any) {
  if (!mix || typeof mix !== 'object') return false;
  if (mix.no_reaction === true) return true;
  if (mix.reaction === 'none' || mix.reaction === 'no_reaction') return true;
  if (mix.type === 'no_reaction') return true;
  return false;
}

function isGenericMixName(name:string, aName:string, bName:string) {
  const lower = name.toLowerCase();
  const aLower = aName.toLowerCase();
  const bLower = bName.toLowerCase();
  if (lower.includes('+')) return true;
  if (lower.startsWith('mix ') || lower.startsWith('mixed ') || lower.includes(' mix ')) return true;
  if (lower.includes(aLower) && lower.includes(bLower)) return true;
  return false;
}

function extractNameOnlyResponse(resp:any) {
  if (!resp) return '';
  if (typeof resp === 'string') return resp.trim();
  if (typeof resp === 'object' && typeof resp.name === 'string') return resp.name.trim();
  return '';
}

try {
  const storedVersion = localStorage.getItem(mixCacheVersionKey);
  if (storedVersion !== mixCacheVersion) {
    clearMixCacheLocal();
    clearMixCacheOnServer();
    localStorage.setItem(mixCacheVersionKey, mixCacheVersion);
  }
} catch (e) {}
try { loadMixCacheFromServer(); } catch (e) {}

function materialNameExists(name:string) {
  if (!name) return false;
  if (materialIdByName.has(name)) return true;
  for (const value of mixCache.values()) {
    if (value && typeof value === 'object' && value.name === name) return true;
  }
  return false;
}
function deriveColorFromName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  const seed = Math.abs(h);
  const r = 60 + (seed % 180);
  const g = 60 + ((seed >> 8) % 180);
  const b = 60 + ((seed >> 16) % 180);
  return [r, g, b];
}

function ensureWorker() {
  if (worker) return;
  worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'ready') {
      console.log('worker ready');
      (window as any).__powderWorker = worker;
    }
    if (m.type === 'material_set') console.log('material set');
    if (m.type === 'grid_set') {
      console.log('grid set on worker');
      try {
        const buf = new Uint16Array(m.grid);
        (window as any).__lastGrid = buf.slice();
        (window as any).__lastGridWidth = m.width;
        const sampleIdx = 10 * m.width + 10;
        (window as any).__lastGridSample = buf[sampleIdx];
        console.log('drawGrid sample [10,10] =', buf[sampleIdx], 'colorMap=', (window as any).__materialColors);
        drawGrid(buf, m.width, m.height);
      } catch(e) {}
    }
    if (m.type === 'reaction') {
      try {
        console.log('reaction applied', JSON.stringify(m));
      } catch (e) {
        console.log('reaction applied', m);
      }
    }
    if (m.type === 'stepped') {
      const buf = new Uint16Array(m.grid);
      try {
        (window as any).__lastGrid = buf.slice();
        (window as any).__lastGridWidth = m.width;
        const sampleIdx = 10 * m.width + 10;
        (window as any).__lastGridSample = buf[sampleIdx];
        console.log('drawGrid sample [10,10] =', buf[sampleIdx], 'colorMap=', (window as any).__materialColors);
      } catch(e) {}
      drawGrid(buf, m.width, m.height);
      maybeAutoGenerateMixes(buf, m.width, m.height);
    }
    if (m.type === 'error') console.warn('worker error', m.message);
  }
  worker.postMessage({type:'init', width:150, height:100});
}

function getMaterialColor(mat:any) {
  let color = [255,255,255];
  if (mat && mat.color) {
    if (typeof mat.color === 'string' && mat.color.startsWith('#')) {
      const hex = mat.color.replace('#','');
      color = [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
    } else if (Array.isArray(mat.color) && mat.color.length >= 3) {
      color = [mat.color[0], mat.color[1], mat.color[2]];
    }
  } else if (mat && mat.name) {
    color = deriveColorFromName(mat.name);
  }
  return color;
}

function setMaterialColor(materialId:number, mat:any) {
  try {
    const color = getMaterialColor(mat);
    const colorMap = (window as any).__materialColors || {};
    colorMap[materialId] = color;
    (window as any).__materialColors = colorMap;
    if (currentMaterialId === materialId) {
      (window as any).__currentMaterialColor = color;
    }
  } catch (e) {
    const colorMap = (window as any).__materialColors || {};
    colorMap[materialId] = mat?.name ? deriveColorFromName(mat.name) : [255,255,255];
    (window as any).__materialColors = colorMap;
    if (currentMaterialId === materialId) {
      (window as any).__currentMaterialColor = [255,255,255];
    }
  }
}

function registerMaterial(mat:any, opts?: { select?: boolean }) {
  ensureWorker();
  const materialId = ++nextMaterialId;
  if (opts?.select !== false) {
    currentMaterialId = materialId;
    (window as any).__currentMaterialId = currentMaterialId;
  }
  if (mat?.name) {
    materialIdByName.set(mat.name, materialId);
  }
  materialById.set(materialId, mat);
  try {
    const map = (window as any).__materialIdByName || {};
    if (mat?.name) map[mat.name] = materialId;
    (window as any).__materialIdByName = map;
  } catch (e) {}

  worker!.postMessage({type:'set_material', material:mat, materialId});
  setMaterialColor(materialId, mat);
  return materialId;
}

function updateMaterial(materialId:number, mat:any) {
  ensureWorker();
  if (mat?.name) {
    materialIdByName.set(mat.name, materialId);
  }
  materialById.set(materialId, mat);
  try {
    const map = (window as any).__materialIdByName || {};
    if (mat?.name) map[mat.name] = materialId;
    (window as any).__materialIdByName = map;
  } catch (e) {}
  worker!.postMessage({type:'set_material', material:mat, materialId});
  setMaterialColor(materialId, mat);
}

function initWorkerWithMaterial(mat:any) {
  registerMaterial(mat, { select: true });

  (window as any).__paintGridPoints = (points:{x:number,y:number}[]) => {
    const id = (window as any).__currentMaterialId || 1;
    worker!.postMessage({type:'paint_points', materialId: id, points});
    if (!mixBlocked) worker!.postMessage({type:'step'});
  }
  worker!.postMessage({type:'step'});
}

(window as any).__initWorkerWithMaterial = initWorkerWithMaterial;

(window as any).__registerMaterial = (mat:any) => {
  if (!mat) return;
  return registerMaterial(mat, { select: false });
};

(window as any).__selectMaterialByName = (name: string) => {
  const id = materialIdByName.get(name);
  if (!id) return;
  currentMaterialId = id;
  (window as any).__currentMaterialId = currentMaterialId;
  const status = document.getElementById('status');
  if (status) status.textContent = `Material ready: ${name}`;
};

function pairKey(a:number, b:number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function getAncestors(mat:any) {
  if (!mat) return [] as string[];
  const base = mat.name ? [mat.name] : [];
  if (Array.isArray(mat.__mixAncestors)) {
    return Array.from(new Set([...base, ...mat.__mixAncestors]));
  }
  if (Array.isArray(mat.__mixParents)) {
    return Array.from(new Set([...base, ...mat.__mixParents]));
  }
  return base;
}

function hasExplicitReaction(aId:number, bId:number) {
  const aMat = materialById.get(aId);
  const bMat = materialById.get(bId);
  if (!aMat || !bMat || !aMat.name || !bMat.name) return false;
  const aReacts = Array.isArray(aMat.reactions) && aMat.reactions.some((r:any) => r.with === bMat.name);
  const bReacts = Array.isArray(bMat.reactions) && bMat.reactions.some((r:any) => r.with === aMat.name);
  return aReacts || bReacts;
}

function normalizeMixMaterial(mat:any, aMat:any, bMat:any) {
  const aName = aMat?.name || 'A';
  const bName = bMat?.name || 'B';
  const aAncestors = getAncestors(aMat);
  const bAncestors = getAncestors(bMat);
  const ancestors = Array.from(new Set([...aAncestors, ...bAncestors]));
  const base = mat && typeof mat === 'object' ? mat : {};
  if (isNoReactionPayload(base)) return null;
  if (!base.name || !Array.isArray(base.primitives) || base.primitives.length === 0) {
    throw new Error('LLM material missing required fields');
  }
  if (isGenericMixName(base.name, aName, bName)) return null;
  return {
    type: 'material',
    name: base.name,
    description: base.description || `Auto-generated mix of ${aName} and ${bName}.`,
    color: base.color,
    density: typeof base.density === 'number' ? base.density : 1,
    primitives: base.primitives,
    budgets: base.budgets || {max_ops: 14, max_spawns: 0},
    __mixParents: [aName, bName],
    __mixAncestors: ancestors
  };
}

async function generateMixMaterial(aMat:any, bMat:any) {
  const aName = aMat?.name || 'A';
  const bName = bMat?.name || 'B';
  const namePrompt = `Return only the name for a new material created by mixing ${aName} and ${bName}. Respond with {"no_reaction": true} if there is no reaction.`;
  const nameResp = await runLocalLLM(namePrompt);
  if (isNoReactionPayload(nameResp)) return null;
  const candidateName = extractNameOnlyResponse(nameResp);
  if (!candidateName || isGenericMixName(candidateName, aName, bName)) return null;
  if (materialNameExists(candidateName)) return null;
  const prompt = `Create a material named "${candidateName}" that represents mixing ${aName} and ${bName}. Provide a material with primitives and budgets. Keep it stable and simple.`;
  const ast = await runLocalLLM(prompt);
  return normalizeMixMaterial(ast, aMat, bMat);
}

function applyMixMaterial(mixSource:any, aMat:any, bMat:any) {
  if (isNoReactionPayload(mixSource)) return;
  const mixMat = normalizeMixMaterial(mixSource, aMat, bMat);
  if (!mixMat) return;
  const mixId = registerMaterial(mixMat, { select: false });
  const reactionForA = { with: bMat.name, result: mixMat.name, byproduct: mixMat.name, priority: 3 };
  const reactionForB = { with: aMat.name, result: mixMat.name, byproduct: mixMat.name, priority: 3 };
  const updatedA = { ...aMat, reactions: [...(aMat.reactions || []), reactionForA] };
  const updatedB = { ...bMat, reactions: [...(bMat.reactions || []), reactionForB] };
  updateMaterial(materialIdByName.get(aMat.name)!, updatedA);
  updateMaterial(materialIdByName.get(bMat.name)!, updatedB);
  const status = document.getElementById('status');
  if (status) status.textContent = `Discovered ${mixMat.name}`;
  try {
    const map = (window as any).__materialIdByName || {};
    map[mixMat.name] = mixId;
    (window as any).__materialIdByName = map;
  } catch (e) {}
  try {
    const cb = (window as any).__addDiscoveredMaterial;
    if (typeof cb === 'function') cb(mixMat);
  } catch (e) {}
}

function addAutoMixReaction(aId:number, bId:number) {
  const aMat = materialById.get(aId);
  const bMat = materialById.get(bId);
  if (!aMat || !bMat || !aMat.name || !bMat.name) return;
  const aAncestors = getAncestors(aMat);
  const bAncestors = getAncestors(bMat);
  for (const anc of aAncestors) {
    if (bAncestors.includes(anc)) return;
  }
  const key = pairKey(aId, bId);
  if (autoMixPairs.has(key)) return;
  autoMixPairs.add(key);

  const cacheKey = mixCacheKey(aMat.name, bMat.name);
  const cached = mixCache.get(cacheKey);
  if (cached) {
    if (isNoReactionPayload(cached)) return;
    applyMixMaterial(cached, aMat, bMat);
    return;
  }

  if (pendingMixes.has(cacheKey)) return;
  pendingMixes.add(cacheKey);
  setMixBlocked(true, `New material discovered! Mixing ${aMat.name} + ${bMat.name}...`);
  fetchMixFromServer(cacheKey)
    .then((remote) => {
      if (remote) {
        mixCache.set(cacheKey, remote);
        saveMixCacheToLocal();
        if (isNoReactionPayload(remote)) return null;
        applyMixMaterial(remote, aMat, bMat);
        return null;
      }
      return generateMixMaterial(aMat, bMat);
    })
    .then(async (mixMat) => {
      if (!mixMat) return;
      const normalized = normalizeMixMaterial(mixMat, aMat, bMat);
      if (!normalized) {
        const noReaction = { type: 'no_reaction', no_reaction: true };
        mixCache.set(cacheKey, noReaction);
        saveMixCacheToLocal();
        await saveMixToServer(cacheKey, noReaction);
        const status = document.getElementById('status');
        if (status) status.textContent = `No reaction: ${aMat.name} + ${bMat.name}`;
        return;
      }
      mixCache.set(cacheKey, stripTransientFields(normalized));
      saveMixCacheToLocal();
      await saveMixToServer(cacheKey, stripTransientFields(normalized));
      applyMixMaterial(normalized, aMat, bMat);
    })
    .catch((err) => {
      console.warn('mix generation failed', err);
      const status = document.getElementById('status');
      if (status) status.textContent = 'Mix generation failed';
      const banner = document.getElementById('mix-banner');
      if (banner) banner.textContent = 'Mix generation failed. Try again.';
    })
    .finally(() => {
      pendingMixes.delete(cacheKey);
      setMixBlocked(pendingMixes.size > 0);
    });
}

function maybeAutoGenerateMixes(buf:Uint16Array, w:number, h:number) {
  if (!buf || !w || !h) return;
  if (mixBlocked) return;
  const pairs: Array<[number, number]> = [];
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const idx = y*w + x;
      const a = buf[idx];
      if (!a) continue;
      if (x + 1 < w) {
        const b = buf[idx + 1];
        if (b && b !== a) {
          const aMat = materialById.get(a);
          const bMat = materialById.get(b);
          const aAncestors = getAncestors(aMat);
          const bAncestors = getAncestors(bMat);
          let sharesAncestor = false;
          for (const anc of aAncestors) {
            if (bAncestors.includes(anc)) { sharesAncestor = true; break; }
          }
          if (sharesAncestor) continue;
          const key = pairKey(a, b);
          if (!autoMixPairs.has(key) && !hasExplicitReaction(a, b)) {
            pairs.push([a, b]);
          }
        }
      }
      if (y + 1 < h) {
        const b = buf[idx + w];
        if (b && b !== a) {
          const aMat = materialById.get(a);
          const bMat = materialById.get(b);
          const aAncestors = getAncestors(aMat);
          const bAncestors = getAncestors(bMat);
          let sharesAncestor = false;
          for (const anc of aAncestors) {
            if (bAncestors.includes(anc)) { sharesAncestor = true; break; }
          }
          if (sharesAncestor) continue;
          const key = pairKey(a, b);
          if (!autoMixPairs.has(key) && !hasExplicitReaction(a, b)) {
            pairs.push([a, b]);
          }
        }
      }
    }
  }
  if (!pairs.length) return;
  const uniquePairs = new Map<string, [number, number]>();
  for (const [a, b] of pairs) {
    const key = pairKey(a, b);
    if (!uniquePairs.has(key)) uniquePairs.set(key, [a, b]);
  }
  for (const [a, b] of uniquePairs.values()) {
    addAutoMixReaction(a, b);
  }
}

function drawGrid(buf:Uint16Array, w:number, h:number) {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  try { ctx.imageSmoothingEnabled = false; } catch(e) {}
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const offCtx = off.getContext('2d')!;
  try { offCtx.imageSmoothingEnabled = false; } catch(e) {}
  const img = offCtx.createImageData(w, h);
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
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(off, 0,0, canvas.width, canvas.height);
}