const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "8787", 10);
const DATA_PATH =
  process.env.MIX_CACHE_PATH || path.join(__dirname, "mix_cache.json");

function loadCache() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
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
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    return send(res, 204, "", { "Content-Length": "0" });
  }

  if (url.pathname === "/health") {
    console.log("[mix_server] health check");
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/client-log" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const level = String(body?.level || "error");
      const message = String(body?.message || "unknown client error");
      const meta = body?.meta || {};
      console.log(`[mix_server] client-${level}`, message, meta);
      return send(res, 200, { ok: true });
    } catch (err) {
      console.log("[mix_server] client-log invalid json", err?.message || err);
      return send(res, 400, { error: "invalid json" });
    }
  }

  const cache = loadCache();

  if (url.pathname === "/mixes" && req.method === "GET") {
    console.log("[mix_server] list mixes", Object.keys(cache).length);
    return send(res, 200, cache);
  }

  if (url.pathname === "/mixes" && req.method === "DELETE") {
    console.log("[mix_server] clear mixes");
    saveCache({});
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/llm" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const prompt = String(body?.prompt || "").trim();
      if (!prompt) return send(res, 400, { error: "missing prompt" });
      const requestedFormat = String(body?.format || "").trim();
      const format =
        requestedFormat &&
        requestedFormat !== "text" &&
        requestedFormat !== "plain"
          ? requestedFormat
          : undefined;
      const system = String(body?.system || "").trim();
      const ollamaUrl =
        process.env.POWDER_PLAY_OLLAMA_URL ||
        "http://localhost:11434/api/generate";
      const model = process.env.POWDER_PLAY_OLLAMA_MODEL || "phi4-reasoning";
      const temperature = parseFloat(
        process.env.POWDER_PLAY_OLLAMA_TEMPERATURE || "0.2",
      );
      console.log("[mix_server] llm request", {
        model,
        format,
        temp: temperature,
        prompt: prompt.slice(0, 140),
      });
      const payload = {
        model,
        prompt: system ? `${system}\n${prompt}` : `${prompt}`,
        stream: false,
        options: { temperature },
      };
      if (format) payload.format = format;
      const ollamaRes = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ollamaRes.ok) {
        const raw = await ollamaRes.text();
        console.log(
          "[mix_server] llm error",
          ollamaRes.status,
          raw.slice(0, 200),
        );
        return send(res, 502, {
          error: "ollama request failed",
          status: ollamaRes.status,
        });
      }
      const data = await ollamaRes.json();
      console.log(
        "[mix_server] llm response",
        String(data?.response || "").slice(0, 200),
      );
      return send(res, 200, { response: data?.response || "" });
    } catch (err) {
      console.log("[mix_server] llm exception", err?.message || err);
      return send(res, 500, { error: "llm error" });
    }
  }

  if (
    url.pathname.startsWith("/mixes/") &&
    (req.method === "GET" || req.method === "POST" || req.method === "PUT")
  ) {
    const key = decodeURIComponent(url.pathname.replace("/mixes/", ""));
    if (!key) return send(res, 400, { error: "missing key" });

    if (req.method === "GET") {
      console.log("[mix_server] get mix", key, cache[key] ? "hit" : "miss");
      if (!cache[key]) return send(res, 404, { error: "not found" });
      return send(res, 200, cache[key]);
    }

    try {
      const body = await readJson(req);
      console.log("[mix_server] set mix", key, Object.keys(body || {}).length);
      if (!body || typeof body !== "object")
        return send(res, 400, { error: "invalid body" });
      if (!cache[key]) {
        cache[key] = body;
        saveCache(cache);
      }
      return send(res, 200, cache[key]);
    } catch (err) {
      console.log("[mix_server] invalid mix json", key, err?.message || err);
      return send(res, 400, { error: "invalid json" });
    }
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[mix_server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mix_server] data file: ${DATA_PATH}`);
});
