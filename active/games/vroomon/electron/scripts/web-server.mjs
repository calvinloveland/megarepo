#!/usr/bin/env node
// Vroomon web server — serves the browser-compatible renderer and
// receives client-side error reports at /api/feedback.
//
// Run: node scripts/web-server.mjs
// Then open http://haswell:5112 in a browser.
//
// Error reports are stored as JSONL in `.secrets/feedback.jsonl` so
// they survive process restarts and can be grepped for triage.

import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync, existsSync as existsSyncSync } from "node:fs";
import { extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.VROOMON_WEB_PORT ?? 5112);
const HOST = process.env.VROOMON_WEB_HOST ?? "0.0.0.0";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const DIST_DIR = resolve(PROJECT_DIR, "dist", "renderer");
const SECRETS_DIR = resolve(PROJECT_DIR, ".secrets");
const FEEDBACK_FILE = resolve(SECRETS_DIR, "feedback.jsonl");

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const FEEDBACK_MAX_BUFFER = 200;

async function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function isValidFeedback(input) {
  if (!input || typeof input !== "object") return false;
  const candidate = input;
  if (!Array.isArray(candidate.errors)) return false;
  return candidate.errors.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.message === "string" &&
      typeof entry.timestamp === "number",
  );
}

async function appendFeedback(payload) {
  await mkdir(SECRETS_DIR, { recursive: true });
  const lines = payload.errors
    .map((entry) => JSON.stringify({ receivedAt: Date.now(), ...entry }))
    .join("\n");
  await appendFile(FEEDBACK_FILE, lines + "\n", "utf8");
  return payload.errors.length;
}

async function readFeedback(limit = 50) {
  if (!existsSyncSync(FEEDBACK_FILE)) return [];
  const text = await readFile(FEEDBACK_FILE, "utf8");
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const recent = lines.slice(-limit);
  return recent.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
}

async function clearFeedback() {
  await mkdir(SECRETS_DIR, { recursive: true });
  await writeFile(FEEDBACK_FILE, "", "utf8");
}

const server = createServer(async (req, res) => {
  // ============ FEEDBACK API ============
  if (req.url?.startsWith("/api/feedback")) {
    // CORS for the feedback endpoint
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (!isValidFeedback(parsed)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid payload" }));
          return;
        }
        const count = await appendFeedback(parsed);

        // Cap the file size: keep only the most recent N entries.
        try {
          const recent = await readFeedback(FEEDBACK_MAX_BUFFER);
          const serialized = recent.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
          await writeFile(FEEDBACK_FILE, serialized, "utf8");
        } catch { /* keep full file on cap failure */ }

        console.log(
          `[feedback] received ${count} error(s) at ${new Date().toISOString()}`,
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, received: count }));
        return;
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
    }

    if (req.method === "GET") {
      try {
        const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const entries = await readFeedback(Number.isFinite(limit) ? limit : 50);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, count: entries.length, entries }));
        return;
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
    }

    if (req.method === "DELETE") {
      try {
        await clearFeedback();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, cleared: true }));
        return;
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  // ============ STATIC FILES ============
  if (req.url?.startsWith("/api/")) {
    res.writeHead(404); res.end("Not found");
    return;
  }

  let path = req.url === "/" ? "/game.html" : req.url;
  // Strip query strings
  path = path?.split("?")[0] ?? "/game.html";

  const filePath = resolve(DIST_DIR, path?.slice(1) ?? "game.html");

  // Prevent directory traversal.
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403); res.end("Forbidden");
    return;
  }

  if (!existsSyncSync(filePath)) {
    res.writeHead(404); res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  const mime = MIME[ext] ?? "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    res.writeHead(500); res.end("Server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🏎️  Vroomon web UI`);
  console.log(`  ────────────────`);
  console.log(`  http://haswell:${PORT}`);
  console.log(`\n  Feedback endpoint: POST/GET/DELETE /api/feedback`);
  console.log(`  Stored at: ${FEEDBACK_FILE}`);
  console.log(`  Hosted adjacent to Conway (port 5106) on haswell.\n`);
});
