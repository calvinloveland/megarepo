import { runLocalLLMText } from "../material_api";

export function initApp(root: HTMLElement) {
  root.className = "min-h-screen w-full p-4";
  root.innerHTML = `
    <div class="flex flex-col lg:flex-row gap-4 items-start">
      <div id="left-panel" class="alchemy-panel min-w-[220px] w-full lg:w-64">
        <h1 style="font-family:'Cinzel',serif;font-size:1.4rem;font-weight:600;color:#d4a574;letter-spacing:2px;text-transform:uppercase;margin-bottom:0.5rem;">Alchemist<br>Powder</h1>
        <div id="materials-panel"></div>
        <div id="status"></div>
        <div id="mix-status" style="font-family:'Inter',sans-serif;font-size:0.65rem;color:rgba(255,255,255,0.35);margin-top:0.25rem;"></div>
      </div>
      <div id="center-panel" class="flex flex-col items-center gap-2 w-full">
        <div class="alchemy-panel w-full flex justify-center relative" style="padding:0.5rem;">
          <div id="mix-banner" class="mix-overlay alchemy-panel hidden">
            <div class="mix-title">New material discovered</div>
            <div id="mix-name" class="mix-name">Mixing...</div>
            <div class="mix-progress-track">
              <div id="mix-progress" class="mix-progress-fill"></div>
            </div>
          </div>
          <canvas id="sim-canvas" width="600" height="400" style="border:1px solid rgba(255,255,255,0.08);border-radius:4px;"></canvas>
        </div>
        <div id="playback-controls" class="alchemy-panel"></div>
      </div>
      <div id="right-panel" class="alchemy-panel min-w-[220px] w-full lg:w-64">
        <h3 style="font-family:'Cinzel',serif;font-size:0.9rem;font-weight:600;color:#d4a574;letter-spacing:1px;text-transform:uppercase;margin-bottom:0.5rem;">Tools</h3>
        <div id="tools-panel" style="display:flex;flex-direction:column;gap:0.5rem;"></div>
      </div>
    </div>
  `;

  const status = document.getElementById("status")!;
  status.textContent = "Ready";
  const mixStatus = document.getElementById("mix-status") as HTMLElement | null;
  if (mixStatus) mixStatus.textContent = "Mix server: checking...";

  const materialsPanel = document.getElementById("materials-panel")!;
  const playbackControls = document.getElementById("playback-controls")!;
  const toolsPanel = document.getElementById("tools-panel")!;

  // mount materials browser
  import("./material_browser").then((m) => {
    m.mountMaterialBrowser(materialsPanel);
  });

  // attach play/step controls
  import("./controls").then((mod) => {
    mod.attachControls(playbackControls, (playingOrStep: boolean) => {
      // playingOrStep true for a tick, false for pause action
      if (!worker) return;
      if (mixBlocked) return;
      if (playingOrStep) worker.postMessage({ type: "step" });
      else worker.postMessage({ type: "step" });
    });
  });

  // attach canvas tools immediately (it will queue paints until worker exists)
  const canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;

  // Setup canvas for devicePixelRatio to reduce blurriness
  function setupCanvasDPR(c: HTMLCanvasElement, cssW = 600, cssH = 400) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.floor(cssW * dpr);
    c.height = Math.floor(cssH * dpr);
    c.style.width = cssW + "px";
    c.style.height = cssH + "px";
    return { dpr, cssW, cssH };
  }
  const _dpr = setupCanvasDPR(canvas, 600, 400);

  import("./canvas_tools").then((mod) => {
    mod.attachCanvasTools(
      canvas,
      (window as any).__powderWorker || null,
      150,
      100,
      toolsPanel,
    );
  });

  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  pingMixServer();
}

let worker: Worker | null = null;
let nextMaterialId = 0;
let currentMaterialId = 0;
const materialById = new Map<number, any>();
const materialIdByName = new Map<string, number>();
const autoMixPairs = new Set<string>();
const mixCache = new Map<string, any>();
const pendingMixes = new Set<string>();
const mix404Logged = new Set<string>();
const mixCacheVersionKey = "alchemistPowder.mixCache.version";
const mixCacheVersion = "v5";
const mixCacheStorageKey = `alchemistPowder.mixCache.${mixCacheVersion}`;
const mixApiBase = (() => {
  const override = (window as any).__mixApiBase;
  if (override) return override;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return "http://127.0.0.1:8787";
})();
// default LLM options for mix generation
// The model (granite4:350m) is small — short, focused prompts work best.
// Two calls: (1) name, (2) combined properties (tags+density+color+desc).
// This is 2.5x faster than the old 5-call approach while staying reliable.
const defaultMixNameOptions = { tokens: 16, temperature: 0.2 };
const defaultMixPropertyOptions = { tokens: 80, temperature: 0.2 };
const MIX_NAME_OPTIONS = Object.assign({}, defaultMixNameOptions, (window as any).__mixNameOptions || {});
const MIX_PROPERTY_OPTIONS = Object.assign({}, defaultMixPropertyOptions, (window as any).__mixPropertyOptions || {});

let mixBlocked = false;
let mixCacheReady = false;
let mixProgress = 0;
let mixName = "Mixing...";

function setMixStatus(message: string) {
  const mixStatus = document.getElementById("mix-status");
  if (mixStatus) mixStatus.textContent = message;
}

function summarizeResponseHeaders(res: Response) {
  return {
    "content-type": res.headers.get("content-type"),
    server: res.headers.get("server"),
    date: res.headers.get("date"),
  };
}

async function readResponseBody(res: Response) {
  try {
    return await res.text();
  } catch (e) {
    return "";
  }
}

async function logMixHttpFailure(
  context: string,
  res: Response,
  extra?: Record<string, any>,
) {
  const body = await readResponseBody(res);
  console.warn(`[mix] ${context} failed`, {
    url: res.url,
    status: res.status,
    headers: summarizeResponseHeaders(res),
    body: body.slice(0, 500),
    ...extra,
  });
  return body;
}

async function pingMixServer() {
  try {
    const res = await fetch(`${mixApiBase}/health`, { cache: "no-store" });
    if (res.ok) {
      setMixStatus(`Mix server: ok (${mixApiBase})`);
      return;
    }
    await logMixHttpFailure("health", res);
    setMixStatus(`Mix server: error ${res.status} (${mixApiBase})`);
  } catch (e) {
    setMixStatus(`Mix server: unreachable (${mixApiBase})`);
  }
}

function mixCacheKey(aName: string, bName: string) {
  return [aName, bName].sort().join("|");
}

function setMixProgress(pct: number) {
  mixProgress = Math.max(0, Math.min(100, pct));
  const bar = document.getElementById("mix-progress") as HTMLElement | null;
  if (bar) bar.style.width = `${mixProgress}%`;
}

function setMixName(name: string) {
  mixName = name;
  const el = document.getElementById("mix-name");
  if (el) el.textContent = mixName;
}

function setMixBlocked(blocked: boolean, message?: string, name?: string) {
  mixBlocked = blocked;
  try {
    (window as any).__mixBlocked = blocked;
  } catch (e) {}
  console.log("[mix] setMixBlocked", { blocked, message, name });
  const banner = document.getElementById("mix-banner");
  if (banner) {
    banner.classList.toggle("hidden", !blocked);
    if (blocked && name) setMixName(name);
    if (blocked && message) {
      const title = banner.querySelector(".mix-title");
      if (title) title.textContent = message;
    }
    if (!blocked) {
      const title = banner.querySelector(".mix-title");
      if (title) title.textContent = "New material discovered";
      setMixName("Mixing...");
      setMixProgress(0);
    }
  }
}

async function reportMixError(message: string, meta?: any) {
  const payload = { level: "error", message, meta };
  try {
    const res = await fetch(`${mixApiBase}/client-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await logMixHttpFailure("client-log", res, { payload });
      setMixStatus(`Mix server: error ${res.status} (${mixApiBase})`);
      return;
    }
  } catch (e) {
    console.warn("mix client-log error", { error: String(e), payload });
  }
  setMixStatus(`Mix server: error (${mixApiBase})`);
}

async function loadMixCacheFromServer() {
  try {
    const res = await fetch(`${mixApiBase}/mixes`, { cache: "no-store" });
    if (!res.ok) {
      await logMixHttpFailure("mix cache fetch", res);
      throw new Error(`mix cache fetch failed: ${res.status}`);
    }
    const parsed = (await res.json()) as Record<string, any>;
    for (const [key, value] of Object.entries(parsed || {})) {
      mixCache.set(key, value);
    }
    mixCacheReady = true;
    try {
      (window as any).__mixCacheReady = true;
    } catch (e) {}
  } catch (e) {
    console.warn("mix cache load failed", e);
    loadMixCacheFromLocal();
  }
}

async function clearMixCacheOnServer() {
  try {
    await fetch(`${mixApiBase}/mixes`, { method: "DELETE" });
  } catch (e) {
    console.warn("mix cache clear failed", e);
  }
}

function sanitizeCachedMix(key: string, value: any) {
  if (!value || typeof value !== "object") return null;
  // require minimal fields
  if (!value.name || String(value.type || "").toLowerCase() !== "material") return null;
  // ensure tags are normalized
  value.tags = normalizeTags(Array.isArray(value.tags) ? value.tags.map((t:any)=>String(t).toLowerCase()) : []);
  if (!Array.isArray(value.tags) || value.tags.length === 0) value.tags = ["static"];
  // density fallback/limit
  if (typeof value.density !== "number" || !Number.isFinite(value.density)) value.density = 1.0;
  value.density = Math.max(0.05, Math.min(10, value.density));
  // sanitize color
  if (!value.color || !Array.isArray(value.color) || value.color.length < 3) {
    value.color = deriveColorFromName(value.name);
  }
  // sanitize description (avoid lists or echoing prompt text)
  const desc = String(value.description || "").trim();
  const isListy = desc.split(/,|;/).length >= 3 && desc.split(/\s+/).length < 20;
  const badEcho = /do not include|only json|return only/i.test(desc);
  if (!desc || isListy || badEcho) {
    const parents = Array.isArray(value.__mixParents) && value.__mixParents.length === 2 ? value.__mixParents : ["A","B"];
    value.description = `Auto-generated mix of ${parents[0]} and ${parents[1]}.`;
  }
  // sanitize name: avoid short or machine-like names saved from noisy LLMs
  const nameStr = String(value.name || "");
  const looksMachine = /_[a-z0-9]{3,}$/.test(nameStr) || /\d{2,}/.test(nameStr) || nameStr.length < 3;
  if (looksMachine) {
    const parents = Array.isArray(value.__mixParents) && value.__mixParents.length === 2 ? value.__mixParents : ["A","B"];
    try {
      value.name = fallbackMixName(String(parents[0]), String(parents[1]));
    } catch (e) {
      // fallback to generic
      value.name = `${parents[0]}_${parents[1]}_mix`;
    }
  }
  return value;
}

function loadMixCacheFromLocal() {
  try {
    const raw = localStorage.getItem(mixCacheStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, any>;
      for (const [key, value] of Object.entries(parsed)) {
        const san = sanitizeCachedMix(key, value);
        if (san) mixCache.set(key, san);
        else {
          console.warn('[mix] dropping invalid cached mix', key, value);
        }
      }
    }
    mixCacheReady = true;
    try {
      (window as any).__mixCacheReady = true;
    } catch (e) {}
  } catch (e) {
    console.warn("mix cache local load failed", e);
    mixCacheReady = true;
    try {
      (window as any).__mixCacheReady = true;
    } catch (e) {}
  }
}

function clearMixCacheLocal() {
  try {
    localStorage.removeItem(mixCacheStorageKey);
  } catch (e) {
    console.warn("mix cache local clear failed", e);
  }
  mixCache.clear();
}

function saveMixCacheToLocal() {
  try {
    const out: Record<string, any> = {};
    for (const [key, value] of mixCache.entries()) {
      const san = sanitizeCachedMix(key, value);
      if (san) out[key] = san;
      else console.warn('[mix] skipping invalid cached mix on save', key, value);
    }
    localStorage.setItem(mixCacheStorageKey, JSON.stringify(out));
  } catch (e) {
    console.warn("mix cache local save failed", e);
  }
}

async function fetchMixFromServer(cacheKey: string) {
  try {
    const res = await fetch(
      `${mixApiBase}/mixes/${encodeURIComponent(cacheKey)}`,
      { cache: "no-store" },
    );
    if (res.status === 404) {
      if (!mix404Logged.has(cacheKey)) {
        mix404Logged.add(cacheKey);
        await logMixHttpFailure("mix cache miss", res, { cacheKey });
      }
      return null;
    }
    if (!res.ok) throw new Error(`mix fetch failed: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("mix fetch failed", e);
    return null;
  }
}

async function saveMixToServer(cacheKey: string, mix: any) {
  try {
    const san = sanitizeCachedMix(cacheKey, mix);
    if (!san) {
      console.warn('[mix] refusing to save invalid mix to server', cacheKey, mix);
      return null;
    }
    const res = await fetch(
      `${mixApiBase}/mixes/${encodeURIComponent(cacheKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(san),
      },
    );
    if (!res.ok) {
      await logMixHttpFailure("mix cache save", res, { cacheKey });
      throw new Error(`mix save failed: ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.warn("mix save failed", e);
    return null;
  }
}

function stripTransientFields(mat: any) {
  if (!mat || typeof mat !== "object") return mat;
  const clone = JSON.parse(JSON.stringify(mat));
  delete clone.__compiled;
  return clone;
}

function isNoReactionPayload(mix: any) {
  if (!mix || typeof mix !== "object") return false;
  if (mix.no_reaction === true) return true;
  if (mix.reaction === "none" || mix.reaction === "no_reaction") return true;
  if (mix.type === "no_reaction") return true;
  return false;
}

function isGenericMixName(name: string, aName: string, bName: string) {
  const lower = name.toLowerCase();
  const aLower = aName.toLowerCase();
  const bLower = bName.toLowerCase();
  if (lower.includes("+")) return true;
  if (
    lower.startsWith("mix ") ||
    lower.startsWith("mixed ") ||
    lower.includes(" mix ")
  )
    return true;
  if (lower.includes(aLower) && lower.includes(bLower)) return true;
  return false;
}

function extractNameOnlyResponse(resp: any) {
  if (!resp) return "";
  if (typeof resp === "string") {
    const raw = resp.trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.no_reaction === true) return "";
        if (typeof parsed.name === "string") return parsed.name.trim();
      }
    } catch (e) {}
    return raw;
  }
  if (typeof resp === "object") {
    if (resp.no_reaction === true) return "";
    if (typeof resp.name === "string") return resp.name.trim();
  }
  return "";
}

const allowedTags = new Set([
  "sand",
  "flow",
  "float",
  "static",
  "water",
  "fire",
  "flammable",
  "reactive_water",
  "explosive",
  "burns_out",
  "smoke",
  "steam",
  "mud",
  "seed",
  "plant",
  "grow",
  "dirt",
]);

function getRecentMixLines(limit = 12) {
  const lines: string[] = [];
  for (const [key, value] of mixCache.entries()) {
    if (!value || typeof value !== "object") continue;
    if (isNoReactionPayload(value)) continue;
    if (!value.name || typeof value.name !== "string") continue;
    const parts = key.split("|");
    if (parts.length !== 2) continue;
    lines.push(`${parts[0]}+${parts[1]}=${value.name}`);
  }
  if (lines.length <= limit) return lines;
  return lines.slice(lines.length - limit);
}

function normalizeTags(tags: string[]) {
  const mobility = ["static", "sand", "flow", "float"];
  const present = mobility.filter((tag) => tags.includes(tag));
  if (present.length <= 1) return tags;
  const preferred = present[0];
  return tags.filter((tag) => !mobility.includes(tag) || tag === preferred);
}

function isNoReactionName(name: string) {
  const cleaned = name.trim().toLowerCase();
  if (!cleaned) return false;
  return (
    cleaned === "no reaction" ||
    cleaned === "no_reaction" ||
    cleaned === "noreaction"
  );
}

function fallbackMixName(aName: string, bName: string) {
  // create a readable fallback like Fire_SaltWater_gz50 to avoid confusing concatenations
  const base = `${aName}-${bName}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  const tag = Math.abs(hash).toString(36).slice(0, 4) || "mix";
  const safeA = aName.replace(/\s+/g, "").slice(0, 8) || "A";
  const safeB = bName.replace(/\s+/g, "").slice(0, 8) || "B";
  return `${safeA}_${safeB}_${tag}`;
}

try {
  const storedVersion = localStorage.getItem(mixCacheVersionKey);
  if (storedVersion !== mixCacheVersion) {
    clearMixCacheLocal();
    clearMixCacheOnServer();
    localStorage.setItem(mixCacheVersionKey, mixCacheVersion);
  }
} catch (e) {}
try {
  loadMixCacheFromLocal();
} catch (e) {}
try {
  loadMixCacheFromServer();
} catch (e) {}

function materialNameExists(name: string) {
  if (!name) return false;
  if (materialIdByName.has(name)) return true;
  for (const value of mixCache.values()) {
    if (value && typeof value === "object" && value.name === name) return true;
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
  worker = new Worker(new URL("../sim/worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") {
      console.log("worker ready");
      (window as any).__powderWorker = worker;
    }
    if (m.type === "material_set") console.log("material set");
    if (m.type === "grid_set") {
      console.log("grid set on worker");
      try {
        const buf = new Uint16Array(m.grid);
        (window as any).__lastGrid = buf.slice();
        (window as any).__lastGridWidth = m.width;
        const sampleIdx = 10 * m.width + 10;
        (window as any).__lastGridSample = buf[sampleIdx];
        console.log(
          "drawGrid sample [10,10] =",
          buf[sampleIdx],
          "colorMap=",
          (window as any).__materialColors,
        );
        drawGrid(buf, m.width, m.height);
      } catch (e) {}
    }
    if (m.type === "reaction") {
      try {
        console.log("reaction applied", JSON.stringify(m));
      } catch (e) {
        console.log("reaction applied", m);
      }
    }
    if (m.type === "stepped") {
      const buf = new Uint16Array(m.grid);
      try {
        (window as any).__lastGrid = buf.slice();
        (window as any).__lastGridWidth = m.width;
        const sampleIdx = 10 * m.width + 10;
        (window as any).__lastGridSample = buf[sampleIdx];
        console.log(
          "drawGrid sample [10,10] =",
          buf[sampleIdx],
          "colorMap=",
          (window as any).__materialColors,
        );
      } catch (e) {}
      drawGrid(buf, m.width, m.height);
      maybeAutoGenerateMixes(buf, m.width, m.height);
    }
    if (m.type === "error") console.warn("worker error", m.message);
  };
  worker.postMessage({ type: "init", width: 150, height: 100 });
}

function getMaterialColor(mat: any) {
  let color = [255, 255, 255];
  if (mat && mat.color) {
    if (typeof mat.color === "string" && mat.color.startsWith("#")) {
      const hex = mat.color.replace("#", "");
      color = [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    } else if (Array.isArray(mat.color) && mat.color.length >= 3) {
      color = [mat.color[0], mat.color[1], mat.color[2]];
    }
  } else if (mat && mat.name) {
    color = deriveColorFromName(mat.name);
  }
  return color;
}

function setMaterialColor(materialId: number, mat: any) {
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
    colorMap[materialId] = mat?.name
      ? deriveColorFromName(mat.name)
      : [255, 255, 255];
    (window as any).__materialColors = colorMap;
    if (currentMaterialId === materialId) {
      (window as any).__currentMaterialColor = [255, 255, 255];
    }
  }
}

function registerMaterial(mat: any, opts?: { select?: boolean }) {
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

  worker!.postMessage({ type: "set_material", material: mat, materialId });
  setMaterialColor(materialId, mat);
  return materialId;
}

function updateMaterial(materialId: number, mat: any) {
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
  worker!.postMessage({ type: "set_material", material: mat, materialId });
  setMaterialColor(materialId, mat);
}

function initWorkerWithMaterial(mat: any) {
  registerMaterial(mat, { select: true });

  (window as any).__paintGridPoints = (points: { x: number; y: number }[]) => {
    const id = (window as any).__currentMaterialId || 1;
    worker!.postMessage({ type: "paint_points", materialId: id, points });
    if (!mixBlocked) worker!.postMessage({ type: "step" });
  };
  worker!.postMessage({ type: "step" });
}

(window as any).__initWorkerWithMaterial = initWorkerWithMaterial;

(window as any).__registerMaterial = (mat: any) => {
  if (!mat) return;
  return registerMaterial(mat, { select: false });
};

(window as any).__selectMaterialByName = (name: string) => {
  const id = materialIdByName.get(name);
  if (!id) return;
  currentMaterialId = id;
  (window as any).__currentMaterialId = currentMaterialId;
  const status = document.getElementById("status");
  if (status) status.textContent = `Material ready: ${name}`;
};

(window as any).__triggerMixForNames = (aName: string, bName: string) => {
  const aId = materialIdByName.get(aName);
  const bId = materialIdByName.get(bName);
  if (!aId || !bId) return false;
  addAutoMixReaction(aId, bId);
  return true;
};

function pairKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function getAncestors(mat: any) {
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

function hasExplicitReaction(aId: number, bId: number) {
  const aMat = materialById.get(aId);
  const bMat = materialById.get(bId);
  if (!aMat || !bMat || !aMat.name || !bMat.name) return false;
  const aReacts =
    Array.isArray(aMat.reactions) &&
    aMat.reactions.some((r: any) => r.with === bMat.name);
  const bReacts =
    Array.isArray(bMat.reactions) &&
    bMat.reactions.some((r: any) => r.with === aMat.name);
  return aReacts || bReacts;
}

function normalizeMixMaterial(mat: any, aMat: any, bMat: any) {
  const aName = aMat?.name || "A";
  const bName = bMat?.name || "B";
  const aAncestors = getAncestors(aMat);
  const bAncestors = getAncestors(bMat);
  const ancestors = Array.from(new Set([...aAncestors, ...bAncestors]));
  const base = mat && typeof mat === "object" ? mat : {};
  if (isNoReactionPayload(base)) return null;
  if (!base.name) {
    throw new Error("LLM material missing required fields");
  }
  const rawTags = Array.isArray(base.tags) ? base.tags : [];
  const tags = rawTags
    .filter((tag: any) => typeof tag === "string")
    .map((tag: string) => tag.trim().toLowerCase())
    .filter((tag: string) => allowedTags.has(tag));
  const hasTags = tags.length > 0;
  if (!hasTags) {
    throw new Error("LLM material missing tags");
  }
  if (isGenericMixName(base.name, aName, bName)) return null;
  const color = base.color || deriveColorFromName(base.name);
  const density = typeof base.density === "number" ? base.density : 1;
  return {
    type: "material",
    name: base.name,
    description:
      base.description || `Auto-generated mix of ${aName} and ${bName}.`,
    color,
    density,
    tags,
    reactions: Array.isArray(base.reactions) ? base.reactions : undefined,
    __mixParents: [aName, bName],
    __mixAncestors: ancestors,
  };
}

function tryNormalizeMixMaterial(mat: any, aMat: any, bMat: any) {
  try {
    return normalizeMixMaterial(mat, aMat, bMat);
  } catch (e) {
    return null;
  }
}

async function generateMixMaterial(aMat: any, bMat: any) {
  const aName = aMat?.name || "A";
  const bName = bMat?.name || "B";
  setMixProgress(10);

  // ── Step 1: Get the material name ──
  // Use a simple prompt with recent mix history as examples.
  const recentLines = getRecentMixLines();
  const recentBlock = recentLines.length ? recentLines.join("\n") + "\n" : "";
  const namePrompt = `${recentBlock}${aName}+${bName}=`;

  let candidateName = "";
  try {
    const nameResp = await runLocalLLMText(namePrompt, MIX_NAME_OPTIONS);
    const raw = (nameResp || "").trim();
    // Extract the last word from the response (the name)
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let lastLine = lines.length ? lines[lines.length - 1] : "";
    if (lastLine.includes("=")) lastLine = lastLine.split("=").pop()!.trim();
    const nameMatch = lastLine.match(/[A-Za-z][A-Za-z0-9_-]*/);
    candidateName = nameMatch ? nameMatch[0] : "";

    // Validate: reject generic names and duplicates
    const lowerName = candidateName.toLowerCase();
    const isGeneric = !candidateName || candidateName.length < 2 ||
      lowerName === "no reaction" || lowerName === "none" ||
      isGenericMixName(candidateName, aName, bName) ||
      /^[a-z]+$/.test(candidateName); // all-lowercase = generic

    if (isGeneric || materialNameExists(candidateName)) {
      candidateName = fallbackMixName(aName, bName);
    }
  } catch (err) {
    console.warn("[mix] name generation failed", err);
    candidateName = fallbackMixName(aName, bName);
  }

  setMixName(candidateName);
  setMixProgress(40);

  // ── Step 2: Get material properties ──
  // Use parent-material tags as basis, then enhance with targeted LLM calls.

  let tags: string[] = [];
  let density = 1.0;
  let color: number[] | null = null;
  let description = "";

  // Derive movement tags from parent materials (most reliable approach)
  const aTags = Array.isArray(aMat?.tags) ? aMat.tags : [];
  const bTags = Array.isArray(bMat?.tags) ? bMat.tags : [];
  const parentMovementTags = [...aTags, ...bTags].filter(
    (t: string) => ["sand","flow","float","static"].includes(t)
  );
  if (parentMovementTags.length > 0) {
    tags = [parentMovementTags[0]];
  } else {
    tags = ["static"];
  }

  // Ask LLM for density (simple number, works well with small models)
  try {
    const densityExamples = ["SaltWater density: 1.0", "Mud density: 1.4", "Steam density: 0.2", "Glass density: 2.5"];
    const densityPrompt = densityExamples.join("\n") + `\n\n${candidateName} density:`;
    const densityResp = await runLocalLLMText(densityPrompt, { tokens: 8, temperature: 0.2 });
    const densityMatch = densityResp.match(/[\d.]+/);
    if (densityMatch) {
      const val = parseFloat(densityMatch[0]);
      if (!isNaN(val) && val > 0) density = Math.max(0.05, Math.min(10, val));
    }
  } catch (err) {
    // Fallback: average of parent densities
    const aDensity = typeof aMat?.density === "number" ? aMat.density : 1;
    const bDensity = typeof bMat?.density === "number" ? bMat.density : 1;
    density = Math.max(0.05, Math.min(10, (aDensity + bDensity) / 2));
  }

  // Ask LLM for color (three numbers, works well)
  try {
    const colorExamples = ["SaltWater color: 180, 200, 240", "Mud color: 120, 100, 80", "Steam color: 200, 200, 220", "Glass color: 190, 200, 210"];
    const colorPrompt = colorExamples.join("\n") + `\n\n${candidateName} color:`;
    const colorResp = await runLocalLLMText(colorPrompt, { tokens: 10, temperature: 0.2 });
    const nums = (colorResp || "").split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (nums.length >= 3) color = nums.slice(0, 3).map(n => Math.max(0, Math.min(255, n)));
  } catch (err) {
    // fall through to deriveColorFromName
  }

  // Ask LLM for description (short sentence)
  try {
    const descExamples = ["SaltWater: Salty clear liquid.", "Mud: Thick wet dirt.", "Steam: Light drifting vapor.", "Glass: Clear brittle solid."];
    const descPrompt = descExamples.join("\n") + `\n\n${candidateName}:`;
    const descResp = await runLocalLLMText(descPrompt, { tokens: 16, temperature: 0.2 });
    description = (descResp || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || "";
    if (description.startsWith(candidateName + ":")) {
      description = description.slice(candidateName.length + 1).trim();
    }
    if (!description || description.length < 3) description = "";
  } catch (err) {
    // fall through
  }

  // Fallbacks
  if (!color) color = deriveColorFromName(candidateName);
  if (!description) description = `${aName} mixed with ${bName}.`;

  setMixProgress(85);

  const draft = {
    type: "material",
    name: candidateName,
    tags,
    density,
    color,
    description,
  };

  const normalized = tryNormalizeMixMaterial(draft, aMat, bMat);
  if (!normalized) {
    await reportMixError("mix normalize failed (2-call)", {
      a: aName,
      b: bName,
      name: candidateName,
      tags,
      density,
      color,
    });
    return null;
  }

  setMixProgress(100);
  return normalized;
}

function applyMixMaterial(mixSource: any, aMat: any, bMat: any) {
  if (isNoReactionPayload(mixSource)) return false;
  const mixMat = tryNormalizeMixMaterial(mixSource, aMat, bMat);
  if (!mixMat) {
    reportMixError("mix normalize failed", {
      stage: "apply",
      a: aMat?.name,
      b: bMat?.name,
      name: mixSource?.name,
      payload: mixSource,
    });
    return false;
  }
  console.log("[mix] applyMixMaterial", {
    mix: mixMat.name,
    a: aMat?.name,
    b: bMat?.name,
  });
  const mixId = registerMaterial(mixMat, { select: false });
  const reactionForA = {
    with: bMat.name,
    result: mixMat.name,
    byproduct: mixMat.name,
    priority: 3,
  };
  const reactionForB = {
    with: aMat.name,
    result: mixMat.name,
    byproduct: mixMat.name,
    priority: 3,
  };
  const updatedA = {
    ...aMat,
    reactions: [...(aMat.reactions || []), reactionForA],
  };
  const updatedB = {
    ...bMat,
    reactions: [...(bMat.reactions || []), reactionForB],
  };
  updateMaterial(materialIdByName.get(aMat.name)!, updatedA);
  updateMaterial(materialIdByName.get(bMat.name)!, updatedB);
  const status = document.getElementById("status");
  if (status) status.textContent = `Discovered ${mixMat.name}`;
  try {
    const map = (window as any).__materialIdByName || {};
    map[mixMat.name] = mixId;
    (window as any).__materialIdByName = map;
  } catch (e) {}
  try {
    const cb = (window as any).__addDiscoveredMaterial;
    if (typeof cb === "function") cb(mixMat);
  } catch (e) {}
  try {
    const list = (window as any).__discoveredMaterials || [];
    list.push(mixMat);
    (window as any).__discoveredMaterials = list;
  } catch (e) {}
  try {
    console.log(
      "[mix] discovered materials count",
      (window as any).__discoveredMaterials?.length || 0,
    );
  } catch (e) {}
  return true;
}

function addAutoMixReaction(aId: number, bId: number) {
  const aMat = materialById.get(aId);
  const bMat = materialById.get(bId);
  if (!aMat || !bMat || !aMat.name || !bMat.name) return;
  if (!mixCacheReady) {
    console.log("[mix] cache not ready, skip", { a: aMat.name, b: bMat.name });
    return;
  }
  console.log("[mix] consider", { a: aMat.name, b: bMat.name });
  const aAncestors = getAncestors(aMat);
  const bAncestors = getAncestors(bMat);
  for (const anc of aAncestors) {
    if (bAncestors.includes(anc)) {
      console.log("[mix] skip shared ancestor", {
        a: aMat.name,
        b: bMat.name,
        anc,
      });
      return;
    }
  }
  const key = pairKey(aId, bId);
  if (autoMixPairs.has(key)) {
    console.log("[mix] skip existing pair", key);
    return;
  }
  autoMixPairs.add(key);

  const cacheKey = mixCacheKey(aMat.name, bMat.name);
  const cached = mixCache.get(cacheKey);
  if (cached) {
    console.log(
      "[mix] cache hit",
      cacheKey,
      cached?.name || cached?.type || "unknown",
    );
    if (isNoReactionPayload(cached)) return;
    const applied = applyMixMaterial(cached, aMat, bMat);
    if (applied) return;
    mixCache.delete(cacheKey);
    saveMixCacheToLocal();
  }

  if (pendingMixes.has(cacheKey)) {
    console.log("[mix] skip pending", cacheKey);
    return;
  }
  pendingMixes.add(cacheKey);
  setMixBlocked(true, "New material discovered", `${aMat.name} + ${bMat.name}`);
  setMixProgress(10);
  fetchMixFromServer(cacheKey)
    .then((remote) => {
      if (remote) {
        console.log(
          "[mix] server cache hit",
          cacheKey,
          remote?.name || remote?.type || "unknown",
        );
        mixCache.set(cacheKey, remote);
        saveMixCacheToLocal();
        if (isNoReactionPayload(remote)) return null;
        setMixProgress(100);
        const applied = applyMixMaterial(remote, aMat, bMat);
        if (!applied) {
          mixCache.delete(cacheKey);
          saveMixCacheToLocal();
          return generateMixMaterial(aMat, bMat);
        }
        return null;
      }
      console.log("[mix] cache miss, generating", cacheKey);
      setMixProgress(25);
      return generateMixMaterial(aMat, bMat);
    })
    .then(async (mixMat) => {
      if (!mixMat) return;
      const normalized = normalizeMixMaterial(mixMat, aMat, bMat);
      if (!normalized) {
        const noReaction = { type: "no_reaction", no_reaction: true };
        mixCache.set(cacheKey, noReaction);
        saveMixCacheToLocal();
        await saveMixToServer(cacheKey, noReaction);
        const status = document.getElementById("status");
        if (status)
          status.textContent = `No reaction: ${aMat.name} + ${bMat.name}`;
        return;
      }
      setMixProgress(95);
      mixCache.set(cacheKey, stripTransientFields(normalized));
      saveMixCacheToLocal();
      await saveMixToServer(cacheKey, stripTransientFields(normalized));
      applyMixMaterial(normalized, aMat, bMat);
      setMixProgress(100);
    })
    .catch((err) => {
      console.warn("mix generation failed", err);
      reportMixError("mix generation failed", {
        error: String(err),
        a: aMat.name,
        b: bMat.name,
      });
      const status = document.getElementById("status");
      if (status) status.textContent = "Mix generation failed";
      const title = document.querySelector("#mix-banner .mix-title");
      if (title) title.textContent = "Mix generation failed. Try again.";
      setMixName("Generation failed");
      setMixProgress(0);
    })
    .finally(() => {
      pendingMixes.delete(cacheKey);
      setMixBlocked(pendingMixes.size > 0);
    });
}

function maybeAutoGenerateMixes(buf: Uint16Array, w: number, h: number) {
  if (!buf || !w || !h) return;
  if (mixBlocked) return;
  console.log("[mix] scan grid for mixes");
  const pairs: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
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
            if (bAncestors.includes(anc)) {
              sharesAncestor = true;
              break;
            }
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
            if (bAncestors.includes(anc)) {
              sharesAncestor = true;
              break;
            }
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

function drawGrid(buf: Uint16Array, w: number, h: number) {
  const canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  try {
    ctx.imageSmoothingEnabled = false;
  } catch (e) {}
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const offCtx = off.getContext("2d")!;
  try {
    offCtx.imageSmoothingEnabled = false;
  } catch (e) {}

  // Draw background (dark grid)
  offCtx.fillStyle = "#0a0e17";
  offCtx.fillRect(0, 0, w, h);

  // Draw subtle grid lines (every 5 cells)
  offCtx.strokeStyle = "rgba(255,255,255,0.04)";
  offCtx.lineWidth = 0.5;
  for (let x = 0; x <= w; x += 5) {
    offCtx.beginPath();
    offCtx.moveTo(x, 0);
    offCtx.lineTo(x, h);
    offCtx.stroke();
  }
  for (let y = 0; y <= h; y += 5) {
    offCtx.beginPath();
    offCtx.moveTo(0, y);
    offCtx.lineTo(w, y);
    offCtx.stroke();
  }

  // Draw material cells
  const img = offCtx.createImageData(w, h);
  const colorMap = (window as any).__materialColors as
    | Record<number, number[]>
    | undefined;
  for (let i = 0; i < w * h; i++) {
    const v = buf[i] & 0xffff;
    const c = v > 0 && colorMap ? colorMap[v] : undefined;
    if (v > 0 && c) {
      img.data[i * 4 + 0] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 255;
    } else {
      img.data[i * 4 + 0] = 10;
      img.data[i * 4 + 1] = 14;
      img.data[i * 4 + 2] = 23;
      img.data[i * 4 + 3] = 255;
    }
  }
  offCtx.putImageData(img, 0, 0);

  // Draw border around the simulation area
  offCtx.strokeStyle = "rgba(255,255,255,0.05)";
  offCtx.lineWidth = 1;
  offCtx.strokeRect(0, 0, w, h);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}
