const http = require("http");
const fs = require("fs");
const path = require("path");

// ── Load .env if present ──────────────────────────────────────────
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    // Only set if not already in environment (env vars take precedence)
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("[mix_server] loaded .env from", envPath);
}

const PORT = parseInt(process.env.PORT || "8787", 10);
const DATA_PATH =
  process.env.MIX_CACHE_PATH || path.join(__dirname, "mix_cache.json");

// Helper: fetch with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ── Security config ────────────────────────────────────────────────
function originMatchesAllowed(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    // Exact match
    if (ALLOWED_ORIGINS.has(origin)) return true;
    // Wildcard: any subdomain of shsw.dev via HTTPS
    if (host.endsWith(".shsw.dev") && u.protocol === "https:") return true;
    return false;
  } catch (e) {
    return false;
  }
}

const ALLOWED_ORIGINS = new Set([
  // Dev servers
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  // Production / public (exact)
  "https://shsw.dev",
  "http://shsw.dev",
]);

function isOriginAllowed(origin) {
  if (!origin) return true;  // Allow no-origin (native/embedded contexts)
  return originMatchesAllowed(origin);
}

const RATE_LIMIT = {
  windowMs: 60_000,         // 1 minute window
  maxPerWindow: 30,         // max LLM calls per window per IP
  maxTokensPerCall: 100,    // max tokens per LLM call
  maxPromptLength: 500,     // max characters in prompt
};

// ── In-memory rate limiter (per-IP) ────────────────────────────────
const ipRequests = new Map();  // ip -> { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = ipRequests.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
    ipRequests.set(ip, entry);
  }
  entry.count++;
  return {
    allowed: entry.count <= RATE_LIMIT.maxPerWindow,
    remaining: Math.max(0, RATE_LIMIT.maxPerWindow - entry.count),
    resetAt: entry.resetAt,
  };
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequests) {
    if (now > entry.resetAt) ipRequests.delete(ip);
  }
}, 300_000);



// ── Existing helpers ────────────────────────────────────────────────
function sanitizeMixEntry(value, key) {
  if (!value || typeof value !== "object") return null;
  if (!value.name || String(value.type || "").toLowerCase() !== "material") return null;
  if (!Array.isArray(value.tags)) value.tags = [];
  value.tags = value.tags.map((t) => String(t || "").toLowerCase()).filter(Boolean);
  if (value.tags.length === 0) value.tags = ["static"];
  if (typeof value.density !== "number" || !Number.isFinite(value.density)) value.density = 1.0;
  value.density = Math.max(0.05, Math.min(10, value.density));
  if (!Array.isArray(value.color) || value.color.length < 3) {
    value.color = [200, 200, 200];
  } else {
    value.color = value.color.slice(0, 3).map((n) => {
      const num = Number(n);
      if (!Number.isFinite(num)) return 200;
      return Math.max(0, Math.min(255, Math.floor(num)));
    });
  }
  const desc = String(value.description || "").trim();
  const isListy = desc.split(/,|;/).length >= 3 && desc.split(/\s+/).length < 20;
  const badEcho = /do not include|only json|return only/i.test(desc);
  if (!desc || isListy || badEcho) {
    const parents = Array.isArray(value.__mixParents) && value.__mixParents.length === 2 ? value.__mixParents : ["A","B"];
    value.description = `Auto-generated mix of ${parents[0]} and ${parents[1]}.`;
  }
  const nameStr = String(value.name || '');
  const looksMachine = /_[a-z0-9]{3,}$/.test(nameStr) || /\d{2,}/.test(nameStr) || nameStr.length < 3;
  if (looksMachine) {
    const parents = Array.isArray(value.__mixParents) && value.__mixParents.length === 2 ? value.__mixParents : ['A','B'];
    value.name = `${parents[0]}_${parents[1]}_mix`;
  }
  return value;
}

function loadCache() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const out = {};
    let changed = false;
    for (const [k, v] of Object.entries(parsed || {})) {
      const san = sanitizeMixEntry(v, k);
      if (san) out[k] = san;
      else {
        console.warn('[mix_server] dropping invalid cached mix', k, v);
        changed = true;
      }
    }
    if (changed) {
      try { saveCache(out); } catch (e) {}
    }
    return out;
  } catch (err) {
    console.error("[mix_server] load error", err);
    return {};
  }
}

function saveCache(cache) {
  try {
    const tmp = DATA_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, DATA_PATH);
  } catch (err) {
    console.error("[mix_server] save error", err);
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body || {});
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
    });
  });
}

// ── HTTP server ────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // ── CORS preflight ──────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return send(res, 204, "", { "Content-Length": "0" });
  }

  // ── Health check (no rate limit, open) ──────────────────────────
  if (url.pathname === "/health") {
    return send(res, 200, { ok: true });
  }

  // ── Client log (rate-limited but light) ─────────────────────────
  if (url.pathname === "/client-log" && req.method === "POST") {
    const rl = checkRateLimit(req.socket.remoteAddress || "unknown");
    if (!rl.allowed) return send(res, 429, { error: "too many requests" });
    try {
      const body = await readJson(req);
      console.log(`[mix_server] client-${body?.level || "error"}`, body?.message || "?", body?.meta || {});
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: "invalid json" });
    }
  }

  // ── Mix cache endpoints (rate-limited) ──────────────────────────
  const cache = loadCache();

  if (url.pathname === "/mixes" && req.method === "GET") {
    return send(res, 200, cache);
  }

  if (url.pathname === "/mixes" && req.method === "DELETE") {
    const rl = checkRateLimit(req.socket.remoteAddress || "unknown");
    if (!rl.allowed) return send(res, 429, { error: "too many requests" });
    saveCache({});
    return send(res, 200, { ok: true });
  }

  // ── LLM endpoint (heavily guarded) ──────────────────────────────
  if (url.pathname === "/llm" && req.method === "POST") {
    // 1. Rate limit check
    const clientIp = req.socket.remoteAddress || "unknown";
    const rl = checkRateLimit(clientIp);
    if (!rl.allowed) {
      console.warn("[mix_server] rate limit hit", clientIp);
      return send(res, 429, {
        error: "rate limit exceeded",
        retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000),
      });
    }

    // 2. Origin check
    const origin = req.headers.origin || req.headers.referer || "";
    if (origin && !isOriginAllowed(origin)) {
      console.warn("[mix_server] blocked origin", origin);
      return send(res, 403, { error: "origin not allowed" });
    }

    try {
      const body = await readJson(req);

      // 3. Validate prompt
      const prompt = String(body?.prompt || "").trim();
      if (!prompt) return send(res, 400, { error: "missing prompt" });
      if (prompt.length > RATE_LIMIT.maxPromptLength) {
        return send(res, 400, { error: "prompt too long", maxLength: RATE_LIMIT.maxPromptLength });
      }

      // 4. Validate prompt content — only allow material-name-like prompts
      //    Block prompts that look like general chat or system manipulation.
      const lower = prompt.toLowerCase();
      if (lower.includes("ignore previous") || lower.includes("ignore all") ||
          lower.includes("forget") || lower.includes("system prompt") ||
          lower.includes("you are now") || lower.includes("act as") ||
          lower.includes("dans") || lower.includes("ignore the")) {
        console.warn("[mix_server] blocked prompt injection", prompt.slice(0, 100));
        return send(res, 403, { error: "prompt rejected" });
      }

      const system = String(body?.system || "").trim();
      const requestedOptions = body?.options || {};
      const temperature = typeof requestedOptions.temperature === 'number'
        ? Math.max(0, Math.min(1, requestedOptions.temperature))
        : parseFloat(process.env.POWDER_PLAY_OLLAMA_TEMPERATURE || "0.2");
      const rawMaxTokens = parseInt(requestedOptions.num_predict || requestedOptions.maxTokens || process.env.POWDER_PLAY_OLLAMA_MAX_TOKENS || "20", 10);
      const maxTokens = Math.min(rawMaxTokens, RATE_LIMIT.maxTokensPerCall);

      console.log("[mix_server] llm request", { maxTokens, prompt: prompt.slice(0, 100), ip: clientIp });

      const backend = process.env.POWDER_PLAY_LLM_BACKEND || "ollama";

      if (backend === "deepseek") {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) return send(res, 502, { error: "LLM not configured" });

        const dsModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
        const dsBase = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";

        const messages = [];
        if (system) messages.push({ role: "system", content: system });
        messages.push({ role: "user", content: prompt });

        const dsRes = await fetchWithTimeout(`${dsBase}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: dsModel,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
          }),
        }, 30000);

        if (!dsRes.ok) {
          const raw = await dsRes.text();
          console.error("[mix_server] deepseek error", dsRes.status, raw.slice(0, 200));
          // Don't expose upstream error details to the client
          return send(res, 502, { error: "LLM request failed" });
        }

        const data = await dsRes.json();
        const content = data?.choices?.[0]?.message?.content || "";
        return send(res, 200, { response: content });
      }

      // Ollama backend
      const ollamaUrl = process.env.POWDER_PLAY_OLLAMA_URL || "http://localhost:11434/api/generate";
      const model = process.env.POWDER_PLAY_OLLAMA_MODEL || "granite4:350m";
      const format = (() => {
        const f = String(body?.format || "").trim();
        return f && f !== "text" && f !== "plain" ? f : undefined;
      })();

      const ollamaRes = await fetchWithTimeout(ollamaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: system ? `${system}\n${prompt}` : `${prompt}`,
          stream: false,
          options: { temperature, num_predict: maxTokens },
          ...(format ? { format } : {}),
        }),
      }, 30000);

      if (!ollamaRes.ok) {
        const raw = await ollamaRes.text();
        console.error("[mix_server] ollama error", ollamaRes.status, raw.slice(0, 200));
        return send(res, 502, { error: "LLM request failed" });
      }

      const data = await ollamaRes.json();
      return send(res, 200, { response: String(data?.response || "") });
    } catch (err) {
      console.error("[mix_server] llm exception", err?.message || err);
      return send(res, 500, { error: "internal error" });
    }
  }

  // ── Mix cache GET/POST/PUT ─────────────────────────────────────
  if (url.pathname.startsWith("/mixes/") &&
      (req.method === "GET" || req.method === "POST" || req.method === "PUT")) {
    const rl = checkRateLimit(req.socket.remoteAddress || "unknown");
    if (!rl.allowed) return send(res, 429, { error: "too many requests" });

    const key = decodeURIComponent(url.pathname.replace("/mixes/", ""));
    if (!key) return send(res, 400, { error: "missing key" });
    // Validate cache key format
    if (!/^[A-Za-z0-9|_ -]+$/.test(key)) {
      return send(res, 400, { error: "invalid cache key" });
    }

    if (req.method === "GET") {
      if (!cache[key]) return send(res, 404, { error: "not found" });
      return send(res, 200, cache[key]);
    }

    try {
      const body = await readJson(req);
      if (!body || typeof body !== "object")
        return send(res, 400, { error: "invalid body" });
      const san = sanitizeMixEntry(body, key);
      if (!san) return send(res, 400, { error: "invalid mix body" });
      if (!cache[key]) {
        cache[key] = san;
        saveCache(cache);
      }
      return send(res, 200, cache[key]);
    } catch (err) {
      return send(res, 400, { error: "invalid json" });
    }
  }

  return send(res, 404, { error: "not found" });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[mix_server] listening on http://127.0.0.1:${PORT}`);
    console.log(`[mix_server] data file: ${DATA_PATH}`);
    console.log(`[mix_server] backend: ${process.env.POWDER_PLAY_LLM_BACKEND || "ollama"}`);
    console.log(`[mix_server] rate limit: ${RATE_LIMIT.maxPerWindow} calls per ${RATE_LIMIT.windowMs/1000}s per IP`);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports.sanitizeMixEntry = sanitizeMixEntry;
}
