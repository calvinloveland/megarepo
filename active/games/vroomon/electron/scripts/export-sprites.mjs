// Exports every code-drawn sprite as a real PNG into
// src/renderer/assets/sprites/ (copied to dist by copy-static) plus a
// manifest.json the runtime consults. Drop-in replacement for AI art:
// name your PNG same as the id in the manifest and rebuild — the game
// prefers the image file over the code drawing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");

const PORT = 5290;
const OUT_DIR = resolve("src/renderer/assets/sprites");

const server = spawn("node", ["scripts/web-server.mjs"], {
  cwd: resolve("."),
  env: { ...process.env, VROOMON_WEB_PORT: String(PORT), VROOMON_WEB_HOST: "127.0.0.1" },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1200));

let browser;
try {
  const executable = process.env.VROOMON_BROWSER_EXECUTABLE;
  browser = await chromium.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/game.html`);
  await page.locator("[data-status-message]").filter({ hasText: "Welcome" }).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => typeof window.__vroomonSprites === "function");
  const sprites = await page.evaluate(() => (window.__vroomonSprites ?? (() => []))());

  mkdirSync(OUT_DIR, { recursive: true });

  // Mixing rule: entries marked `source: "generated"` are hand-made or
  // AI-generated art and are PRESERVED across exports (pass --force to
  // overwrite them with freshly drawn versions). Everything else is
  // rendered from the drawing code and marked `source: "drawn"`.
  const force = process.argv.includes("--force");
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(join(OUT_DIR, "manifest.json"), "utf8"));
    } catch {
      return [];
    }
  })();
  const preserved = new Map(
    previous
      .filter((entry) => entry.source === "generated")
      .map((entry) => [entry.id, entry]),
  );

  const manifest = [];
  let drawn = 0;
  let kept = 0;
  for (const sprite of sprites) {
    const existing = preserved.get(sprite.id);
    if (existing && !force && existsSync(join(OUT_DIR, existing.file))) {
      manifest.push(existing);
      kept += 1;
      continue;
    }
    const file = `${sprite.id.replace(/[^a-zA-Z0-9_-]+/g, "_")}.png`;
    const buffer = Buffer.from(sprite.dataUrl.split(",")[1], "base64");
    writeFileSync(join(OUT_DIR, file), buffer);
    manifest.push({ id: sprite.id, file, source: "drawn" });
    drawn += 1;
  }
  // Generated art for ids the drawing code no longer emits stays listed.
  for (const entry of preserved.values()) {
    if (!manifest.some((candidate) => candidate.id === entry.id) && existsSync(join(OUT_DIR, entry.file))) {
      manifest.push(entry);
      kept += 1;
    }
  }
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(
    `Exported ${drawn} drawn sprites (kept ${kept} generated) to ${OUT_DIR}`,
  );
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
