import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const indexSourcePath = resolve("src/renderer/index.html");
const indexDestinationPath = resolve("dist/renderer/index.html");
const gameSourcePath = resolve("src/renderer/game.html");
const gameDestinationPath = resolve("dist/renderer/game.html");
const preloadSourcePath = resolve("dist/preload.js");
const preloadDestinationPath = resolve("dist/preload.mjs");

for (const destinationPath of [indexDestinationPath, gameDestinationPath, preloadDestinationPath]) {
  const destinationDir = dirname(destinationPath);

  if (!existsSync(destinationDir)) {
    mkdirSync(destinationDir, { recursive: true });
  }
}

cpSync(indexSourcePath, indexDestinationPath);
cpSync(gameSourcePath, gameDestinationPath);
cpSync(preloadSourcePath, preloadDestinationPath);

const indexHtml = readFileSync(indexSourcePath, "utf8");
const e2eHtml = indexHtml
  .replace(
    "</head>",
    `    <script src="../../node_modules/matter-js/build/matter.js"></script>\n    <script type="importmap">\n      {\n        "imports": {\n          "matter-js": "./matter-browser-shim.js"\n        }\n      }\n    </script>\n  </head>`,
  )
  .replace(
    '<script type="module" src="./renderer.js"></script>',
    '    <script src="./playwright-preload-shim.js"></script>\n    <script type="module" src="./renderer.js"></script>',
  );

writeFileSync(resolve("dist/renderer/e2e.html"), e2eHtml);

// Bundle the web-facing modules so the browser can load them without
// resolving the deep relative imports the source uses. Each entry
// becomes a single self-contained file the browser can execute.
async function bundleWebAssets() {
  // The shim sets up `window.vroomon` and is loaded as a regular script
  // (not a module) so its IIFE body runs immediately on parse.
  await build({
    entryPoints: [resolve("src/renderer/playwright-preload-shim.ts")],
    outfile: resolve("dist/renderer/playwright-preload-shim.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    sourcemap: false,
    minify: false,
    logLevel: "warning",
  });
  // The renderer uses ESM imports internally, so we bundle it as ESM and
  // load it with `<script type="module">`.
  await build({
    entryPoints: [resolve("src/renderer/renderer.ts")],
    outfile: resolve("dist/renderer/renderer.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    sourcemap: false,
    minify: false,
    logLevel: "warning",
  });
  // The evolution worker is loaded as an ESM module via the Web Worker
  // constructor. It also has bare imports that the browser cannot resolve,
  // so we bundle it into a single self-contained ESM file.
  await build({
    entryPoints: [resolve("src/renderer/evolution.worker.ts")],
    outfile: resolve("dist/renderer/evolution.worker.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    sourcemap: false,
    minify: false,
    logLevel: "warning",
  });
}

await bundleWebAssets();
