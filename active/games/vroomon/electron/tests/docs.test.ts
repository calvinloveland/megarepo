import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Documentation rots in the same way code does, and just as quietly. Two
// failures are worth catching mechanically because both are invisible until
// somebody follows a link:
//
//   1. A table of contents whose anchors no longer match the headings - which
//      happens the moment a heading is renamed, and there are seventy of them.
//   2. A cross-document link to a file that was moved or renamed.

// The docs live beside the app: this test runs from electron/.
const DOCS = "../docs";

/** GitHub's heading-to-anchor rule, which is what the index was built with. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function headingsOf(text: string): string[] {
  return Array.from(text.matchAll(/^#{1,6} (.+)$/gm)).map((match) => slug(match[1]!));
}

const markdownFiles = readdirSync(DOCS).filter((name) => name.endsWith(".md"));

describe("the docs", () => {
  it("has an index whose every link still lands somewhere", () => {
    const index = readFileSync(`${DOCS}/index.md`, "utf8");
    const missingFiles: string[] = [];
    const missingAnchors: string[] = [];

    for (const match of index.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!;
      if (/^https?:/.test(target)) {
        continue;
      }
      const [file, anchor] = target.split("#");
      if (file && !markdownFiles.includes(file)) {
        missingFiles.push(target);
        continue;
      }
      if (!anchor) {
        continue;
      }
      const source = readFileSync(`${DOCS}/${file || "index.md"}`, "utf8");
      if (!headingsOf(source).includes(anchor)) {
        missingAnchors.push(target);
      }
    }

    expect(missingFiles, `index links to files that do not exist: ${missingFiles.join(", ")}`).toEqual([]);
    expect(missingAnchors, `index links to headings that do not exist: ${missingAnchors.join(", ")}`).toEqual([]);
  });

  it("has a notes index whose anchors match the notes", () => {
    // The log carries a table of contents for its own dated entries, built
    // once by hand from the headings. Rename one and the link dies silently.
    const notes = readFileSync(`${DOCS}/gameplay-ui-notes.md`, "utf8");
    const anchors = Array.from(notes.matchAll(/\]\(#([^)]+)\)/g)).map((match) => match[1]!);
    expect(anchors.length).toBeGreaterThan(20);

    const headings = new Set(headingsOf(notes));
    const broken = anchors.filter((anchor) => !headings.has(anchor));
    expect(broken, `the notes index points at headings that are gone: ${broken.join(", ")}`).toEqual([]);

    // And the list has to be COMPLETE, or it goes stale the moment somebody
    // adds an entry and forgets - which it already had, by six entries.
    const indexed = new Set(anchors);
    const unindexed = Array.from(notes.matchAll(/^## (.+2026-09-15.+)$/gm))
      .map((match) => slug(match[1]!))
      .filter((anchor) => !indexed.has(anchor));
    expect(unindexed, `dated entries missing from the index: ${unindexed.join(", ")}`).toEqual([]);
  });

  it("keeps every code fence closed", () => {
    // An unclosed fence swallows the rest of the page on the docs site.
    const unbalanced: string[] = [];
    for (const file of markdownFiles) {
      const text = readFileSync(`${DOCS}/${file}`, "utf8");
      const fences = (text.match(/^```/gm) ?? []).length;
      if (fences % 2 !== 0) {
        unbalanced.push(`${file} (${fences} fences)`);
      }
    }
    expect(unbalanced, `unclosed code fences: ${unbalanced.join(", ")}`).toEqual([]);
  });
});

describe("the design overview's trustworthiness", () => {
  it("says when it was last checked, and the counts still look right", () => {
    // A document that states measurements has a shelf life, and the honest
    // thing is to date it. The counts are checked loosely - a test count is a
    // rough proxy for how much has changed since - so that a suite which has
    // grown or shrunk by a fifth sends the reader back to re-measure.
    const overview = readFileSync(`${DOCS}/design-overview.md`, "utf8");
    const line = overview.split("\n").find((text) => text.includes("Last verified"));
    expect(line, "design-overview.md has no 'Last verified' line").toBeDefined();

    const claimed = line!.match(/(\d+)\s*unit\s*\+\s*(\d+)\s*e2e/);
    expect(claimed, `the line does not name counts: ${line}`).not.toBeNull();

    // The e2e files are *.e2e.ts rather than *.test.ts, so match on any .ts.
    const declared = (dir: string): number =>
      readdirSync(dir)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => readFileSync(join(dir, name), "utf8"))
        .join("\n")
        // Vitest declares `it(`; Playwright declares `test(`.
        .match(/\b(?:it|test)\(/g)?.length ?? 0;

    const units = declared("tests");
    const e2e = declared(join("tests", "e2e"));
    const [claimedUnits, claimedE2e] = [Number(claimed![1]), Number(claimed![2])];
    const within = (claimed: number, actual: number): boolean =>
      claimed > 0 && Math.abs(claimed - actual) / actual < 0.2;

    expect(
      within(claimedUnits, units),
      `the overview claims ${claimedUnits} unit tests; the suite declares ${units}`,
    ).toBe(true);
    expect(
      within(claimedE2e, e2e),
      `the overview claims ${claimedE2e} e2e tests; the suite declares ${e2e}`,
    ).toBe(true);
  });
});
