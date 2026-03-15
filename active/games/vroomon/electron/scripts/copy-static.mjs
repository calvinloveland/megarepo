import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const filesToCopy = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/e2e.html", "dist/renderer/e2e.html"],
  ["dist/preload.js", "dist/preload.mjs"],
];

for (const [source, destination] of filesToCopy) {
  const sourcePath = resolve(source);
  const destinationPath = resolve(destination);
  const destinationDir = dirname(destinationPath);

  if (!existsSync(destinationDir)) {
    mkdirSync(destinationDir, { recursive: true });
  }

  cpSync(sourcePath, destinationPath);
}
