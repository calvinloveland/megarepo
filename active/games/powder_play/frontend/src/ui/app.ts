import { runLocalLLM, runLocalLLMText } from "../material_api";
import promptTemplates from "../../../material_gen/prompt_templates.json";

export function initApp(root: HTMLElement) {
  root.className = "min-h-screen w-full p-4";
  root.innerHTML = `
    <div class="flex flex-col lg:flex-row gap-4 items-start">
      <div id="left-panel" class="alchemy-panel min-w-[220px] w-full lg:w-64">
        <h1 class="text-2xl">Alchemist Powder</h1>
        <div id="materials-panel"></div>
        <div id="status" class="alchemy-muted"></div>
        <div id="mix-status" class="alchemy-muted text-xs"></div>
      </div>
      <div id="center-panel" class="flex flex-col items-center gap-2 w-full">
        <div class="alchemy-panel w-full flex justify-center relative">
          <div id="mix-banner" class="mix-overlay alchemy-panel hidden">
            <div class="mix-title">New material discovered</div>
            <div id="mix-name" class="mix-name">Mixing...</div>
            <div class="mix-progress-track">
              <div id="mix-progress" class="mix-progress-fill"></div>
            </div>
          </div>
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
// default LLM options for mix generation (tuned from experiments)
const defaultMixNameOptions = { tokens: 16, temperature: 0.2 };
const defaultMixPropertyOptions = { tokens: 20, temperature: 0.2 };
const MIX_NAME_OPTIONS = Object.assign({}, defaultMixNameOptions, (window as any).__mixNameOptions || {});
const MIX_PROPERTY_OPTIONS = Object.assign({}, defaultMixPropertyOptions, (window as any).__mixPropertyOptions || {});
// cache for per-name property responses to avoid re-requesting LLM for same candidate
const mixPropertyCache = new Map<string, any>();

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

function loadMixCacheFromLocal() {
  try {
    const raw = localStorage.getItem(mixCacheStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, any>;
      for (const [key, value] of Object.entries(parsed)) {
        mixCache.set(key, value);
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
      out[key] = value;
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
    const res = await fetch(
      `${mixApiBase}/mixes/${encodeURIComponent(cacheKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mix),
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

const mixTagExamples = [
  "Sand => sand",
  "Water => flow, water",
  "Oil => flow, flammable",
  "Steam => float, steam",
  "Smoke => float, smoke",
  "Salt => sand",
  "Metal => static",
  "Stone => sand",
  "Wood => static, flammable",
  "Glass => static",
  "Fire => float, fire, burns_out",
  "Sodium => sand, reactive_water, explosive",
  "Mud => flow, mud",
  "Seed => sand, seed",
  "Plant => static, plant, grow",
  "Dirt => sand, dirt",
];

const mixDensityExamples = [
  "Sand => 1.6",
  "Water => 1.0",
  "Oil => 0.9",
  "Steam => 0.2",
  "Smoke => 0.1",
  "Salt => 2.0",
  "Metal => 3.5",
  "Stone => 2.4",
  "Wood => 0.7",
  "Glass => 2.5",
];

const mixColorExamples = [
  "Sand => 160,150,130",
  "Water => 80,120,200",
  "Oil => 90,80,60",
  "Steam => 200,200,220",
  "Smoke => 180,180,190",
  "Salt => 220,220,220",
  "Metal => 120,120,130",
  "Stone => 180,170,160",
  "Wood => 120,90,60",
  "Glass => 190,200,210",
];

const mixDescriptionExamples = [
  "Sand => Heavy granular sand.",
  "Water => Clear flowing liquid.",
  "Oil => Slick viscous liquid.",
  "Steam => Light drifting vapor.",
  "Smoke => Thin sooty haze.",
  "Salt => Sharp crystalline grains.",
  "Metal => Solid heavy metal.",
  "Stone => Hard rough solid.",
  "Wood => Dry fibrous solid.",
  "Glass => Clear brittle solid.",
];

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

function buildMixNamePrompt(aName: string, bName: string) {
  const template = String(
    (promptTemplates as any).mix_name_prompt ||
      "Mixes:\n{{recent}}\n{{a}}+{{b}}=",
  );
  const recentLines = getRecentMixLines();
  const recentBlock = recentLines.length ? recentLines.join("\n") : "";
  return template
    .replace("{{recent}}", recentBlock)
    .replace("{{a}}", aName)
    .replace("{{b}}", bName);
}

function buildMixTagsPrompt(name: string) {
  const lines = ["Tags:"];
  lines.push(...mixTagExamples);
  lines.push(`${name} =>`);
  lines.push(
    "Return only comma-separated tags from: sand, flow, float, static, water, fire, flammable, reactive_water, explosive, burns_out, smoke, steam, mud, seed, plant, grow, dirt.",
  );
  return lines.join("\n");
}

function buildMixDensityPrompt(name: string) {
  const lines = ["Densities:"];
  lines.push(...mixDensityExamples);
  lines.push(`${name} =>`);
  lines.push("Return only the numeric density.");
  return lines.join("\n");
}

function buildMixColorPrompt(name: string) {
  const lines = ["Colors (RGB):"];
  lines.push(...mixColorExamples);
  lines.push(`${name} =>`);
  lines.push("Return only three comma-separated integers (r,g,b).");
  return lines.join("\n");
}

function buildMixDescriptionPrompt(name: string) {
  const lines = ["Descriptions:"];
  lines.push(...mixDescriptionExamples);
  lines.push(`${name} =>`);
  lines.push("Return a short sentence only.");
  return lines.join("\n");
}

function parseMixNameResponse(resp: string, aName: string, bName: string) {
  if (!resp) return "";
  const rawLines = resp
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!rawLines.length) return "";
  let line = rawLines[rawLines.length - 1];
  if (line.includes("=")) {
    line = line.slice(line.lastIndexOf("=") + 1).trim();
  }
  line = line.replace(/^[-–—\s]+/, "").trim();
  line = line.replace(/^['"`]+|['"`]+$/g, "").trim();
  const firstWordMatch = line.match(/[A-Za-z0-9_-]+/);
  if (firstWordMatch) {
    line = firstWordMatch[0].trim();
  }
  const lower = line.toLowerCase();
  if (lower.includes("no reaction") || lower.includes("no_reaction"))
    return null;
  if (!line) return "";
  if (isNoReactionName(line)) return null;
  if (isGenericMixName(line, aName, bName)) return "";
  return line;
}

function parseTagsResponse(resp: string) {
  if (!resp) return [] as string[];
  const tokens = resp
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const tags = tokens.filter((t) => allowedTags.has(t));
  return normalizeTags(Array.from(new Set(tags)));
}

function normalizeTags(tags: string[]) {
  const mobility = ["static", "sand", "flow", "float"];
  const present = mobility.filter((tag) => tags.includes(tag));
  if (present.length <= 1) return tags;
  const preferred = present[0];
  return tags.filter((tag) => !mobility.includes(tag) || tag === preferred);
}

function parseDensityResponse(resp: string) {
  if (!resp) return null as number | null;
  const match = resp.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0.05, Math.min(10, value));
}

function parseColorResponse(resp: string) {
  if (!resp) return null as number[] | null;
  const matches = resp.match(/-?\d+(?:\.\d+)?/g) || [];
  if (matches.length < 3) return null;
  const nums = matches.slice(0, 3).map((m) => Math.round(Number.parseFloat(m)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums.map((n) => Math.max(0, Math.min(255, n)));
}

function parseDescriptionResponse(resp: string) {
  if (!resp) return "";
  const line =
    resp
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)[0] || "";
  return line.replace(/^[-–—\s]+/, "").trim();
}

function fallbackTags(aMat: any, bMat: any) {
  const aTags = Array.isArray(aMat?.tags) ? aMat.tags : [];
  const bTags = Array.isArray(bMat?.tags) ? bMat.tags : [];
  for (const tag of aTags) {
    if (bTags.includes(tag) && allowedTags.has(tag)) return [tag];
  }
  const ordered = ["flow", "sand", "float", "static", "fire", "water"];
  for (const tag of ordered) {
    if (aTags.includes(tag) || bTags.includes(tag)) return [tag];
  }
  return ["static"];
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
  const base = `${aName}-${bName}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  const tag = Math.abs(hash).toString(36).slice(0, 4) || "mix";
  const safeA = aName.replace(/\s+/g, "").slice(0, 6) || "A";
  const safeB = bName.replace(/\s+/g, "").slice(0, 6) || "B";
  return `${safeA}${safeB}_${tag}`;
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
  setMixProgress(20);
  const namePrompt = buildMixNamePrompt(aName, bName);
  const retryNamePrompt = `Mixes:\n${aName}+${bName}=\nReturn only the new material name on the final line.`;
  async function getValidName(prompt: string) {
    const nameResp = await runLocalLLMText(prompt, MIX_NAME_OPTIONS);
    const candidate = parseMixNameResponse(nameResp, aName, bName);
    if (candidate === null) return null;
    if (!candidate) return "";
    if (materialNameExists(candidate)) return "";
    return candidate;
  }
  let candidateName = await getValidName(namePrompt);
  if (candidateName === "") candidateName = await getValidName(retryNamePrompt);
  if (candidateName === null) return null;
  if (!candidateName) {
    candidateName = fallbackMixName(aName, bName);
  }
  if (
    materialNameExists(candidateName) ||
    isGenericMixName(candidateName, aName, bName)
  ) {
    candidateName = `${fallbackMixName(aName, bName)}_${Date.now().toString(36).slice(-3)}`;
  }
  setMixName(candidateName);
  setMixProgress(55);
  const tagPrompt = buildMixTagsPrompt(candidateName);
  const densityPrompt = buildMixDensityPrompt(candidateName);
  const colorPrompt = buildMixColorPrompt(candidateName);
  const descPrompt = buildMixDescriptionPrompt(candidateName);

  // timing instrumentation for performance analysis
  const timing: any = { name: candidateName, a: aName, b: bName, start: Date.now() };

  const t0 = Date.now();
  // run property prompts in parallel with tuned tokens per prompt
  const tagPromise = (async () => {
    const s = Date.now();
    const r = await runLocalLLMText(tagPrompt, { tokens: MIX_PROPERTY_OPTIONS.tokens, temperature: MIX_PROPERTY_OPTIONS.temperature });
    return { resp: r, dur: Date.now() - s };
  })();
  const densityPromise = (async () => {
    const s = Date.now();
    const r = await runLocalLLMText(densityPrompt, { tokens: Math.max(8, Math.floor(MIX_PROPERTY_OPTIONS.tokens / 2)), temperature: MIX_PROPERTY_OPTIONS.temperature });
    return { resp: r, dur: Date.now() - s };
  })();
  const colorPromise = (async () => {
    const s = Date.now();
    const r = await runLocalLLMText(colorPrompt, { tokens: Math.max(10, Math.floor(MIX_PROPERTY_OPTIONS.tokens * 0.6)), temperature: MIX_PROPERTY_OPTIONS.temperature });
    return { resp: r, dur: Date.now() - s };
  })();
  const descPromise = (async () => {
    const s = Date.now();
    const r = await runLocalLLMText(descPrompt, { tokens: Math.max(12, Math.floor(MIX_PROPERTY_OPTIONS.tokens * 0.6)), temperature: MIX_PROPERTY_OPTIONS.temperature });
    return { resp: r, dur: Date.now() - s };
  })();

  // check cache first
  const cached = mixPropertyCache.get(candidateName);
  let tagResp: string, densityResp: string, colorResp: string, descResp: string;
  if (cached) {
    tagResp = cached.tagResp;
    densityResp = cached.densityResp;
    colorResp = cached.colorResp;
    descResp = cached.descResp;
    timing.tag = cached.timing?.tag || 0;
    timing.density = cached.timing?.density || 0;
    timing.color = cached.timing?.color || 0;
    timing.desc = cached.timing?.desc || 0;
  } else {
    const [tagRes, densityRes, colorRes, descRes] = await Promise.all([tagPromise, densityPromise, colorPromise, descPromise]);
    tagResp = tagRes?.resp || "";
    densityResp = densityRes?.resp || "";
    colorResp = colorRes?.resp || "";
    descResp = descRes?.resp || "";

    timing.tag = tagRes?.dur || 0;
    timing.density = densityRes?.dur || 0;
    timing.color = colorRes?.dur || 0;
    timing.desc = descRes?.dur || 0;

    mixPropertyCache.set(candidateName, { tagResp, densityResp, colorResp, descResp, timing: { tag: timing.tag, density: timing.density, color: timing.color, desc: timing.desc } });
  }

  setMixProgress(85);

  timing.total = Date.now() - t0;
  timing.elapsed = Date.now() - timing.start;
  try {
    (window as any).__mixGenerationTimings = (window as any).__mixGenerationTimings || [];
    (window as any).__mixGenerationTimings.push(timing);
  } catch (e) {}

  let tags = parseTagsResponse(tagResp);
  if (!tags.length) {
    await reportMixError("mix tags parse failed", {
      a: aName,
      b: bName,
      name: candidateName,
      response: tagResp,
    });
    tags = fallbackTags(aMat, bMat);
  }
  let density = parseDensityResponse(densityResp);
  if (density === null) {
    await reportMixError("mix density parse failed", {
      a: aName,
      b: bName,
      name: candidateName,
      response: densityResp,
    });
    const aDensity = typeof aMat?.density === "number" ? aMat.density : 1;
    const bDensity = typeof bMat?.density === "number" ? bMat.density : 1;
    density = Math.max(0.05, Math.min(10, (aDensity + bDensity) / 2));
  }
  let color = parseColorResponse(colorResp);
  if (!color) {
    await reportMixError("mix color parse failed", {
      a: aName,
      b: bName,
      name: candidateName,
      response: colorResp,
    });
    color = deriveColorFromName(candidateName);
  }
  let description = parseDescriptionResponse(descResp);
  if (!description) {
    await reportMixError("mix description parse failed", {
      a: aName,
      b: bName,
      name: candidateName,
      response: descResp,
    });
    description = `Auto-generated mix of ${aName} and ${bName}.`;
  }

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
    await reportMixError("mix normalize failed", {
      a: aName,
      b: bName,
      name: candidateName,
      stage: "properties",
      responses: { tagResp, densityResp, colorResp, descResp },
    });
    return null;
  }
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
      img.data[i * 4 + 0] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
  }
  offCtx.putImageData(img, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
}
