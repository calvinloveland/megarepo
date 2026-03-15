import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const indexSourcePath = resolve("src/renderer/index.html");
const indexDestinationPath = resolve("dist/renderer/index.html");
const preloadSourcePath = resolve("dist/preload.js");
const preloadDestinationPath = resolve("dist/preload.mjs");

for (const destinationPath of [indexDestinationPath, preloadDestinationPath]) {
  const destinationDir = dirname(destinationPath);

  if (!existsSync(destinationDir)) {
    mkdirSync(destinationDir, { recursive: true });
  }
}

cpSync(indexSourcePath, indexDestinationPath);
cpSync(preloadSourcePath, preloadDestinationPath);

const indexHtml = readFileSync(indexSourcePath, "utf8");
const e2eHtml = indexHtml
  .replace(
    "</head>",
    `    <script src="../../node_modules/matter-js/build/matter.js"></script>\n    <script type="importmap">\n      {\n        "imports": {\n          "matter-js": "./matter-browser-shim.js"\n        }\n      }\n    </script>\n  </head>`,
  )
  .replace(
    '<script type="module" src="./renderer.js"></script>',
    '    <script type="module" src="./playwright-preload-shim.js"></script>\n    <script type="module" src="./renderer.js"></script>',
  );

writeFileSync(resolve("dist/renderer/e2e.html"), e2eHtml);
