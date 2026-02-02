import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "data");

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5174,
    configureServer(server) {
      server.middlewares.use("/api/labels", async (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const payload = JSON.parse(body) as { image?: string };
            if (!payload?.image || typeof payload.image !== "string") {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: "Missing image field." }));
              return;
            }

            const imageName = path.basename(payload.image);
            const safeName = imageName.replace(/[^a-zA-Z0-9._-]/g, "_");
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
    }
  }
});
