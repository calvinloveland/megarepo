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

/**
 * Modules with no test naming them, and the behaviour that covers each one
 * instead. `coveredBy` is a claim the suite verifies: it must name a file that
 * exists, or a test title that the e2e file really contains — so a reason here
 * cannot quietly become a parking space.
 */
const UNTESTED_ON_PURPOSE = new Map<string, { reason: string; coveredBy: string }>([
  [
    "src/main.ts",
    { reason: "Electron entry point", coveredBy: "scripts/smoke-electron.mjs" },
  ],
  [
    "src/preload.ts",
    { reason: "the context bridge", coveredBy: "scripts/smoke-electron.mjs" },
  ],
  [
    "src/renderer/ambience.ts",
    { reason: "re-export shim", coveredBy: "tests/game/ambience-layer.test.ts" },
  ],
  [
    "src/renderer/audio.ts",
    { reason: "WebAudio, no DOM-free surface", coveredBy: "cycles the ambient sound pad" },
  ],
  [
    "src/renderer/matter-browser-shim.ts",
    { reason: "browser shim for the Matter build", coveredBy: "tests/e2e/vroomon.e2e.ts" },
  ],
  [
    "src/renderer/world/overworld-controller.ts",
    { reason: "state machine driven through the walks", coveredBy: "walks through the overworld" },
  ],
  [
    "src/renderer/world/sprites.ts",
    { reason: "sprite loading and drawing", coveredBy: "paints the overworld canvas" },
  ],
  [
    "src/renderer/renderer.ts",
    { reason: "the app shell", coveredBy: "tests/e2e/vroomon.e2e.ts" },
  ],
  [
    "src/renderer/playwright-preload-shim.ts",
    { reason: "stands in for the preload in e2e runs", coveredBy: "tests/e2e/vroomon.e2e.ts" },
  ],
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

/**
 * Every test file in the suite, wherever it lives. The suite is split into
 * engine / game / balance, so a scan of `tests/` alone would find nothing —
 * which is exactly how this test announced the split had happened.
 */
function suiteSource(): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".test.ts")) {
        out.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk("tests");
  return out.join("\n");
}

describe("every module has a test, or a reason", () => {
  it("names each source module somewhere in the suite", () => {
    const tests = suiteSource();

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
    const tests = suiteSource();
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

describe("the reasons are claims, not parking spaces", () => {
  it("names a real behaviour for every listed module", () => {
    // Each entry says what covers it instead of a test. That claim is checked:
    // it must be a file that exists, or a title the e2e file actually has.
    const e2e = readFileSync(join("tests", "e2e", "vroomon.e2e.ts"), "utf8");
    const files = new Set<string>([
      ...readdirSync("tests").map((name) => join("tests", name)),
      ...readdirSync(join("tests", "engine")).map((name) => join("tests", "engine", name)),
      ...readdirSync(join("tests", "game")).map((name) => join("tests", "game", name)),
      ...readdirSync(join("tests", "balance")).map((name) => join("tests", "balance", name)),
      ...readdirSync("scripts").map((name) => join("scripts", name)),
      ...readdirSync(join("tests", "e2e")).map((name) => join("tests", "e2e", name)),
    ]);

    const unverifiable: string[] = [];
    for (const [file, claim] of UNTESTED_ON_PURPOSE) {
      const isFile = files.has(claim.coveredBy);
      const isTestTitle = e2e.includes(claim.coveredBy);
      if (!isFile && !isTestTitle) {
        unverifiable.push(`${file} claims "${claim.coveredBy}"`);
      }
    }
    expect(
      unverifiable,
      `coverage claims that name nothing: ${unverifiable.join(", ")}`,
    ).toEqual([]);
  });

  it("says why, in words rather than a shrug", () => {
    for (const [file, claim] of UNTESTED_ON_PURPOSE) {
      expect(claim.reason.length, `${file} has no reason`).toBeGreaterThan(12);
    }
  });
});
