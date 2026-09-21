// The heritage graph: every vroomon the run has ever bred, wired together by
// parent links, so the player can watch families branch and trace where a
// champion came from. Pure model (no DOM) so it can be unit-tested; the
// renderer only lays it out and paints it.

import type { PopulationEntry, RunStateSnapshot } from "../shared/parity-contract.js";

export interface HeritageNode {
  id: string;
  /** Short label: the id's sequence tail (e.g. "00133"). */
  label: string;
  parents: string[];
  children: string[];
  /** Score when the car still exists in the herd; null once it's gone. */
  score: number | null;
  mutated: boolean;
  /** Generations back from the oldest known ancestor (0 = founder). */
  depth: number;
  /** Position within its depth column (0 = top). */
  row: number;
}

export interface HeritageGraph {
  nodes: HeritageNode[];
  /** depth -> ids, in draw order. */
  columns: string[][];
  maxDepth: number;
  champions: string[];
  /** The best-scoring car still traceable (or null). */
  champion: HeritageNode | null;
  edges: number;
}

export function shortLabel(id: string): string {
  const tail = id.split("-").pop() ?? id;
  return tail.replace(/^0+/, "") || "0";
}

/**
 * Build the heritage graph from the live run: the population gives current
 * scores, and the genealogy map remembers the parent -> child links of
 * ancestors that have since been released.
 */
export function buildHeritageGraph(state: {
  population: PopulationEntry[];
  genealogy: Record<string, string[]>;
}): HeritageGraph {
  const nodes = new Map<string, HeritageNode>();

  const ensure = (id: string): HeritageNode => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        label: shortLabel(id),
        parents: [],
        children: [],
        score: null,
        mutated: false,
        depth: 0,
        row: 0,
      };
      nodes.set(id, node);
    }
    return node;
  };

  // Current herd: scores + parent links.
  for (const entry of state.population) {
    const node = ensure(entry.id);
    node.score = entry.score;
    node.mutated = Boolean(entry.mutated);
    for (const parent of entry.parents ?? []) {
      node.parents.push(parent);
      const parentNode = ensure(parent);
      if (!parentNode.children.includes(entry.id)) {
        parentNode.children.push(entry.id);
      }
    }
  }

  // Genealogy: ancestors that left the herd still remember their children.
  for (const [parent, children] of Object.entries(state.genealogy ?? {})) {
    const parentNode = ensure(parent);
    for (const child of children) {
      if (!parentNode.children.includes(child)) {
        parentNode.children.push(child);
      }
      const childNode = ensure(child);
      if (!childNode.parents.includes(parent)) {
        childNode.parents.push(parent);
      }
    }
  }

  // Depth = longest path from a founder (memoised, cycle-guarded).
  const depthOf = new Map<string, number>();
  const visiting = new Set<string>();
  const resolveDepth = (id: string): number => {
    const cached = depthOf.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      return 0; // defensive: a cycle should never happen
    }
    visiting.add(id);
    const node = nodes.get(id);
    const parents = node?.parents ?? [];
    const depth =
      parents.length === 0
        ? 0
        : Math.max(...parents.map((parent) => resolveDepth(parent) + 1));
    visiting.delete(id);
    depthOf.set(id, depth);
    return depth;
  };

  const all = [...nodes.values()];
  for (const node of all) {
    node.depth = resolveDepth(node.id);
  }

  const maxDepth = all.reduce((max, node) => Math.max(max, node.depth), 0);
  const columns: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const node of all) {
    columns[node.depth]!.push(node.id);
  }
  for (const column of columns) {
    column.sort((left, right) => {
      const a = nodes.get(left)!;
      const b = nodes.get(right)!;
      const scoreDiff = (b.score ?? -1) - (a.score ?? -1);
      return scoreDiff !== 0 ? scoreDiff : a.id.localeCompare(b.id);
    });
    column.forEach((id, index) => {
      nodes.get(id)!.row = index;
    });
  }

  // Champions: the best of their column, so each generation shows its winner.
  const champions: string[] = [];
  for (const column of columns) {
    const best = column
      .map((id) => nodes.get(id)!)
      .filter((node) => node.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (best) {
      champions.push(best.id);
    }
  }
  const champion =
    all
      .filter((node) => node.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;

  return {
    nodes: all,
    columns,
    maxDepth,
    champions,
    champion,
    edges: all.reduce((sum, node) => sum + node.parents.length, 0),
  };
}


export interface HeritageTrace {
  /** The clicked car, its ancestors (nearest first, then their parents). */
  ancestors: string[];
  /** Everything descended from it, breadth-first. */
  descendants: string[];
  /** Orderly chain from the oldest ancestor to the clicked car. */
  chain: string[];
}

/**
 * Trace one car's line: who it came from and what it produced. This is the
 * "follow the family" interaction — the graph is pretty, the trace is the
 * point.
 */
export function traceHeritage(graph: HeritageGraph, id: string): HeritageTrace {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const start = byId.get(id);
  if (!start) {
    return { ancestors: [], descendants: [], chain: [] };
  }

  const ancestors: string[] = [];
  const seen = new Set<string>([id]);
  const queue: string[] = [...start.parents];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    ancestors.push(current);
    const node = byId.get(current);
    if (node) {
      queue.push(...node.parents);
    }
  }

  const descendants: string[] = [];
  const seenDown = new Set<string>([id]);
  const down: string[] = [...start.children];
  while (down.length > 0) {
    const current = down.shift()!;
    if (seenDown.has(current)) {
      continue;
    }
    seenDown.add(current);
    descendants.push(current);
    const node = byId.get(current);
    if (node) {
      down.push(...node.children);
    }
  }

  // The neat chain: oldest ancestor first, closing on the clicked car.
  const chain: string[] = [];
  let cursor: HeritageNode | undefined = start;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.unshift(cursor.id);
    cursor = cursor.parents.length > 0 ? byId.get(cursor.parents[0]) : undefined;
  }

  return { ancestors, descendants, chain };
}


// ---------------------------------------------------------------------------
// The line report: a branch read as a pedigree rather than a tree of dots.
// ---------------------------------------------------------------------------

export interface LineRow {
  /** How far back the car sits (0 = the founder end of the chain). */
  depth: number;
  id: string;
  label: string;
  /** The car's score, when the herd still knew it. */
  score: number | null;
  /** Was it a champion of its generation? */
  champion: boolean;
  /** How many generations of the herd sit between it and the clicked car. */
  stepsFromHere: number;
}

export interface LineReport {
  /** Oldest ancestor first, the clicked car last. */
  rows: LineRow[];
  /** The herd's own best, generation by generation, for context. */
  series: Array<{ generation: number; bestScore: number }>;
  /** Best score anywhere on this line, when any link still has one. */
  best: { id: string; label: string; score: number } | null;
}

/**
 * Read one chain as a pedigree: each link with the score the herd recorded for
 * it (only the latest generation carries scores, so older links read as
 * historical), plus the herd's own curve behind it.
 */
export function lineReport(
  graph: HeritageGraph,
  trace: HeritageTrace,
  options: { scoreHistory?: Array<{ generation: number; bestScore: number }> } = {},
): LineReport {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const champions = new Set(graph.champions);
  const chain = trace.chain.length > 0 ? trace.chain : [];

  const rows: LineRow[] = chain.map((id, index) => {
    const node = byId.get(id);
    const score = node?.score ?? null;
    return {
      depth: node?.depth ?? index,
      id,
      label: node?.label ?? shortLabel(id),
      score,
      champion: champions.has(id),
      stepsFromHere: chain.length - 1 - index,
    };
  });

  let best: LineReport["best"] = null;
  for (const row of rows) {
    if (row.score !== null && (!best || row.score > best.score)) {
      best = { id: row.id, label: row.label, score: row.score };
    }
  }

  return {
    rows,
    series: (options.scoreHistory ?? []).map((entry) => ({
      generation: entry.generation,
      bestScore: entry.bestScore,
    })),
    best,
  };
}

/** "gen 7 · 130.69 pts · line: #12 ← #30 ← #55" — the one-line summary. */
export function describeLine(report: LineReport): string {
  if (report.rows.length === 0) {
    return "no line recorded";
  }
  const here = report.rows[report.rows.length - 1]!;
  const chain = report.rows.map((row) => `#${row.label}`).join(" ← ");
  const score = here.score !== null ? ` · ${here.score.toFixed(2)} pts` : " · released";
  return `gen ${here.depth}${score} · line: ${chain}`;
}
