#!/usr/bin/env node
/**
 * Launcher reverse proxy — routes subdomains to app ports.
 *
 * Reads apps.yaml and creates routes based on subdomain:
 *   powder.shsw.dev:80  →  localhost:5173
 *   gallery.shsw.dev:80 →  localhost:3000
 *   shsw.dev:80         →  localhost:3001 (launcher itself)
 *
 * Usage: sudo node proxy.js
 * (port 80 requires root; use PROXY_PORT=8080 for non-root testing)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PROXY_PORT = parseInt(process.env.PROXY_PORT || "80", 10);
const PROXY_HOST = process.env.PROXY_HOST || "0.0.0.0";
const LAUNCHER_PORT = parseInt(process.env.LAUNCHER_PORT || "3001", 10);
const APPS_FILE = path.join(__dirname, "apps.yaml");

// ── Load app routes from apps.yaml ─────────────────────────────
function loadRoutes() {
  const routes = {};
  try {
    const raw = fs.readFileSync(APPS_FILE, "utf8");
    // Parse each app block manually
    const appBlocks = raw.split(/\n  - id:/).slice(1);
    for (const block of appBlocks) {
      const id = block.match(/^\s*([^\s]+)/)?.[1]?.replace(/"/g, "") || "";
      const subdomain = block.match(/subdomain:\s*"?([^\s"]+)/)?.[1];
      const portMatch = block.match(/port:\s*(\d+)/);
      const port = portMatch ? parseInt(portMatch[1], 10) : null;
      if (subdomain && port) {
        routes[subdomain] = { target: `http://localhost:${port}`, name: id };
        console.log(`  ${subdomain}.shsw.dev -> localhost:${port} (${id})`);
      }
    }
  } catch (err) {
    console.error("Error loading apps.yaml:", err.message);
  }
  return routes;
}

// ── Proxy request to target ──────────────────────────────────────
function proxyRequest(req, res, targetUrl) {
  const url = new URL(req.url || "/", targetUrl);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: req.method,
    headers: { ...req.headers, host: url.host },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Copy status and headers
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`Proxy error for ${targetUrl}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    }
  });

  req.pipe(proxyReq);
}

// ── HTTP server ──────────────────────────────────────────────────
const routes = loadRoutes();
console.log(`\nRoutes: ${Object.keys(routes).length} apps registered`);
console.log(`Launcher: localhost:${LAUNCHER_PORT}`);

const server = http.createServer((req, res) => {
  const host = (req.headers.host || "").toLowerCase();
  const subdomain = host.split(".")[0];

  if (subdomain && routes[subdomain]) {
    proxyRequest(req, res, routes[subdomain].target);
  } else {
    // Default: send to launcher
    proxyRequest(req, res, `http://localhost:${LAUNCHER_PORT}`);
  }
});

// Handle errors gracefully
server.on("error", (err) => {
  if (err.code === "EACCES") {
    console.error(`\n❌ Permission denied: port ${PROXY_PORT} requires root.`);
    console.error(`   Try: sudo node ${__filename}`);
    console.error(`   Or:  PROXY_PORT=8080 node ${__filename} (non-root)`);
  } else {
    console.error("Server error:", err.message);
  }
  process.exit(1);
});

server.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(`\n🚀 Reverse proxy listening on http://${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`   Open http://shsw.dev (or any subdomain.shsw.dev:${PROXY_PORT})`);
  console.log(`   Requires DNS or /etc/hosts entries for shsw.dev`);
});
