// Re-export the sprites and prove nothing changed.
//
// Two things this catches that `tests/sprite-export.test.ts` cannot:
//
//   1. Non-deterministic art — a drawing that reads Math.random, a clock or a
//      locale would produce different pictures on every export, and the stamp
//      only records the SOURCE, not the output.
//   2. A drawing that is fine but emits a different set of ids between runs.
//
// It is a script rather than a test because it needs a browser and takes about
// half a minute. It restores the committed files afterwards, so running it is
// always safe: the point is the diff, not the export.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SPRITES = resolve("src/renderer/assets/sprites");
const BACKUP = join(tmpdir(), `vroomon-sprites-${process.pid}`);

const digest = (dir) => {
  const out = new Map();
  for (const name of readdirSync(dir).sort()) {
    out.set(name, createHash("sha256").update(readFileSync(join(dir, name))).digest("hex"));
  }
  return out;
};

mkdirSync(BACKUP, { recursive: true });
cpSync(SPRITES, BACKUP, { recursive: true });
const before = digest(SPRITES);

let failed = false;
try {
  console.log("Re-exporting sprites to check determinism…");
  execFileSync("npm", ["run", "export:sprites"], { stdio: "inherit" });
  const after = digest(SPRITES);

  const changed = [...after.keys()].filter((name) => before.get(name) !== after.get(name));
  const added = [...after.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !after.has(name));

  if (changed.length === 0 && added.length === 0 && removed.length === 0) {
    console.log(`\nDeterministic: ${after.size} files re-exported identically.`);
  } else {
    failed = true;
    console.error("\nThe export is NOT reproducible:");
    for (const name of changed) console.error(`  changed  ${name}`);
    for (const name of added) console.error(`  added    ${name}`);
    for (const name of removed) console.error(`  removed  ${name}`);
    console.error("\nLook for randomness or a clock in the drawing code.");
  }
} finally {
  // Always leave the tree exactly as it was found.
  rmSync(SPRITES, { recursive: true, force: true });
  cpSync(BACKUP, SPRITES, { recursive: true });
  rmSync(BACKUP, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
