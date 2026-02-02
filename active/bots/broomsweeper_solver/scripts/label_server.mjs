import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../data");
const port = Number(process.env.LABEL_SERVER_PORT ?? 5175);

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.url !== "/api/labels" || req.method !== "POST") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      if (!payload?.image || typeof payload.image !== "string") {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Missing image field." }));
        return;
      }

      const safeName = path.basename(payload.image).replace(/[^a-zA-Z0-9._-]/g, "_");
      await fs.mkdir(dataDir, { recursive: true });
      const outputPath = path.join(dataDir, `${safeName}.labels.json`);
      await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf-8");

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, file: `${safeName}.labels.json` }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Failed to save labels." }));
    }
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Label server listening on http://127.0.0.1:${port}/api/labels`);
});
