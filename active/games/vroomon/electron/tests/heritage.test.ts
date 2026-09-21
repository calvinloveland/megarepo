import { describe, expect, it } from "vitest";
import {
  buildHeritageGraph,
  describeLine,
  lineReport,
  shortLabel,
  traceHeritage,
} from "../src/renderer/heritage.js";

const car = (
  id: string,
  score: number,
  parents: string[] = [],
  mutated = false,
) => ({ id, dna: "AAAAAAAA", score, parents, mutated });

describe("heritage graph", () => {
  it("shortens ids to the sequence tail", () => {
    expect(shortLabel("run-00042")).toBe("42");
    expect(shortLabel("preview-x-00133")).toBe("133");
    expect(shortLabel("plain")).toBe("plain");
  });

  it("chains parents into depth columns", () => {
    const graph = buildHeritageGraph({
      population: [car("r-1", 100), car("r-2", 300, ["r-1"]), car("r-3", 250, ["r-2"])],
      genealogy: { "r-1": ["r-2"], "r-2": ["r-3"], "r-3": [] },
    });
    expect(graph.maxDepth).toBe(2);
    expect(graph.columns.map((column) => column.length)).toEqual([1, 1, 1]);
    expect(graph.edges).toBe(2);
    expect(graph.champion?.id).toBe("r-2");
  });

  it("remembers ancestors that were released", () => {
    // r-9 is long gone from the herd but the genealogy still links it.
    const graph = buildHeritageGraph({
      population: [car("r-20", 900, ["r-9"])],
      genealogy: { "r-9": ["r-20"] },
    });
    const ancestor = graph.nodes.find((node) => node.id === "r-9");
    expect(ancestor).toBeDefined();
    expect(ancestor?.score).toBeNull();
    expect(ancestor?.children).toEqual(["r-20"]);
    expect(graph.maxDepth).toBe(1);
  });

  it("sorts each generation column by score and marks a champion", () => {
    const graph = buildHeritageGraph({
      population: [car("a", 10), car("b", 500), car("c", 200)],
      genealogy: {},
    });
    expect(graph.columns[0]).toEqual(["b", "c", "a"]);
    expect(graph.champion?.id).toBe("b");
    expect(graph.champions).toEqual(["b"]);
    // rows follow the sort
    expect(graph.nodes.find((n) => n.id === "b")?.row).toBe(0);
  });

  it("survives an empty herd", () => {
    const graph = buildHeritageGraph({ population: [], genealogy: {} });
    expect(graph.nodes).toEqual([]);
    expect(graph.maxDepth).toBe(0);
    expect(graph.champion).toBeNull();
  });
});

describe("heritage tracing", () => {
  const graph = buildHeritageGraph({
    population: [
      { id: "a", dna: "A", score: 100, parents: [], mutated: false },
      { id: "b", dna: "B", score: 900, parents: ["a"], mutated: true },
      { id: "c", dna: "C", score: 300, parents: ["b"], mutated: false },
      { id: "d", dna: "D", score: 50, parents: ["b"], mutated: false },
    ],
    genealogy: { a: ["b"], b: ["c", "d"], c: [], d: [] },
  });

  it("walks the whole line back through the parents", () => {
    const trace = traceHeritage(graph, "c");
    expect(trace.ancestors).toEqual(["b", "a"]);
    expect(trace.chain).toEqual(["a", "b", "c"]);
  });

  it("finds every descendant", () => {
    expect(traceHeritage(graph, "b").descendants.sort()).toEqual(["c", "d"]);
    expect(traceHeritage(graph, "a").descendants.sort()).toEqual(["b", "c", "d"]);
  });

  it("traces a founder as a leaf of the past", () => {
    const trace = traceHeritage(graph, "a");
    expect(trace.ancestors).toEqual([]);
    expect(trace.chain).toEqual(["a"]);
  });

  it("returns nothing for an unknown car", () => {
    expect(traceHeritage(graph, "nope").chain).toEqual([]);
  });
});

describe("the line report", () => {
  const population = [
    { id: "h-1", dna: "a", parents: [] as string[], score: 100 },
    { id: "h-2", dna: "b", parents: ["h-1"], score: 250 },
    { id: "h-3", dna: "c", parents: ["h-2"], score: 640 },
    { id: "h-4", dna: "d", parents: ["h-1"], score: 180 },
  ];
  const graph = buildHeritageGraph({ population, genealogy: { "h-1": ["h-2", "h-4"], "h-2": ["h-3"] } });

  it("reads a branch as a pedigree, oldest first", () => {
    const trace = traceHeritage(graph, "h-3");
    const report = lineReport(graph, trace, {
      scoreHistory: [
        { generation: 1, bestScore: 100 },
        { generation: 2, bestScore: 250 },
        { generation: 3, bestScore: 640 },
      ],
    });

    expect(report.rows.map((row) => row.id)).toEqual(["h-1", "h-2", "h-3"]);
    // Depth climbs along the line, and the clicked car is zero steps from here.
    expect(report.rows.map((row) => row.depth)).toEqual([0, 1, 2]);
    expect(report.rows[report.rows.length - 1]!.stepsFromHere).toBe(0);
    expect(report.rows[0]!.stepsFromHere).toBe(2);
    // The best link on the line is named.
    expect(report.best).toEqual({ id: "h-3", label: "3", score: 640 });
    expect(report.series.map((entry) => entry.bestScore)).toEqual([100, 250, 640]);
  });

  it("says a line in one breath", () => {
    const report = lineReport(graph, traceHeritage(graph, "h-3"));
    expect(describeLine(report)).toContain("gen 2");
    expect(describeLine(report)).toContain("line: #");
    expect(describeLine(report)).toContain("pts");
    // Nothing traced: say so rather than printing nonsense.
    expect(describeLine(lineReport(graph, { ancestors: [], descendants: [], chain: [] }))).toBe(
      "no line recorded",
    );
  });
});
