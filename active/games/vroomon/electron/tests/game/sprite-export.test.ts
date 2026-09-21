import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The runtime prefers the exported PNGs over drawing anything itself, which is
// what makes them replaceable with real art — and also what makes a stale
// export invisible: change the drawing code, forget to re-export, and the game
// quietly keeps showing the old pictures. Nothing caught that before; this
// does, by comparing the stamp the exporter wrote with the current sources.

const SPRITES = "src/renderer/assets/sprites";

describe("the exported sprites", () => {
  it("was made from the drawing code that is in the tree now", () => {
    let stamp: { hash: string; sources: string[] };
    try {
      stamp = JSON.parse(readFileSync(join(SPRITES, "source-hash.json"), "utf8"));
    } catch {
      throw new Error(
        `no export stamp in ${SPRITES} — run \`npm run export:sprites\``,
      );
    }

    const hash = createHash("sha256");
    for (const file of stamp.sources) {
      hash.update(file);
      hash.update(readFileSync(resolve(file)));
    }
    expect(
      hash.digest("hex"),
      "the sprite drawing code has changed since the last export — " +
        "run `npm run export:sprites` so the PNGs match it",
    ).toBe(stamp.hash);
  });

  it("lists a file for every sprite in the manifest", () => {
    const manifest = JSON.parse(
      readFileSync(join(SPRITES, "manifest.json"), "utf8"),
    ) as Array<{ id: string; file: string; source: string }>;
    expect(manifest.length).toBeGreaterThan(100);
    const ids = new Set(manifest.map((entry) => entry.id));
    expect(ids.size).toBe(manifest.length);
    // Every drawn entry must have its picture beside the manifest.
    for (const entry of manifest.filter((candidate) => candidate.source === "drawn")) {
      expect(() => readFileSync(join(SPRITES, entry.file))).not.toThrow();
    }
  });
});
