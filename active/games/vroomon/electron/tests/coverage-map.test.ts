import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A map of which source modules have a test that names them. Not a coverage
// percentage - a module can be named and barely exercised - but it catches the
// common case of a new pure helper arriving with no test at all, which is
// exactly how `frame.ts` and `factions.ts` sat for weeks while the modules
// built on top of them were thoroughly tested.
//
// Like the walk-on ledger, this fails in both directions: a module with no
// test has to be either tested or listed here on purpose, and a listed module
// that gains a test must be removed from the list.

const UNTESTED_ON_PURPOSE = new Map<string, string>([
  ["src/main.ts", "Electron entry point; covered by the headless smoke run"],
  ["src/preload.ts", "the context bridge; covered by the smoke run"],
  ["src/renderer/ambience.ts", "re-export shim over ambience-layer"],
  ["src/renderer/audio.ts", "WebAudio, no DOM-free surface worth asserting"],
  ["src/renderer/matter-browser-shim.ts", "browser shim for the Matter build"],
  ["src/renderer/world/overworld-controller.ts", "state machine driven through the e2e walks"],
  ["src/renderer/world/sprites.ts", "sprite loading and drawing; e2e screenshots cover it"],
  ["src/renderer/renderer.ts", "the app shell; the e2e suite is its test"],
  ["src/renderer/playwright-preload-shim.ts", "stands in for the preload in every e2e run"],
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith(".ts") && entry !== "index.ts") {
      out.push(path);
    }
  }
  return out;
}

describe("every module has a test, or a reason", () => {
  it("names each source module somewhere in the suite", () => {
    const tests = readdirSync("tests")
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => readFileSync(join("tests", name), "utf8"))
      .join("\n");

    const untested: string[] = [];
    for (const file of sourceFiles("src")) {
      const stem = file.replace(/^.*\//, "").replace(/\.ts$/, "");
      if (tests.includes(`/${stem}.js"`) || tests.includes(`/${stem}.js'`)) {
        continue;
      }
      if (UNTESTED_ON_PURPOSE.has(file)) {
        continue;
      }
      untested.push(file);
    }
    expect(
      untested,
      `modules with no test naming them: ${untested.join(", ")} — write one, or ` +
        `add them to UNTESTED_ON_PURPOSE with a reason`,
    ).toEqual([]);
  });

  it("does not keep a reason for a module that is now tested", () => {
    const tests = readdirSync("tests")
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => readFileSync(join("tests", name), "utf8"))
      .join("\n");
    const stale: string[] = [];
    for (const file of UNTESTED_ON_PURPOSE.keys()) {
      const stem = file.replace(/^.*\//, "").replace(/\.ts$/, "");
      if (tests.includes(`/${stem}.js"`) || tests.includes(`/${stem}.js'`)) {
        stale.push(file);
      }
    }
    expect(stale, `now tested, so drop them from the list: ${stale.join(", ")}`).toEqual([]);
  });
});
