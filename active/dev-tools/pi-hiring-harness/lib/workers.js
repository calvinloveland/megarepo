import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export const DEFAULT_WORKER_SCOPE = "user";

function toNumberOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCsv(value) {
  if (!value) return undefined;
  const items = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function isDirectory(candidatePath) {
  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectWorkersDir(cwd) {
  let currentDir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(currentDir, ".pi", "workers");
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function parseWorkerMarkdown(content, filePath, source) {
  const { frontmatter, body } = parseFrontmatter(content);
  if (!frontmatter.name || !frontmatter.description) return null;

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    role: frontmatter.role || undefined,
    model: frontmatter.model || undefined,
    tools: parseCsv(frontmatter.tools),
    tags: parseCsv(frontmatter.tags),
    inputPricePerMillion: toNumberOrUndefined(frontmatter.input_price_per_million),
    outputPricePerMillion: toNumberOrUndefined(frontmatter.output_price_per_million),
    maxBudgetUsd: toNumberOrUndefined(frontmatter.max_budget_usd),
    systemPrompt: body.trim(),
    filePath,
    source,
  };
}

export function loadWorkersFromDir(dir, source) {
  const workers = [];
  if (!dir || !fs.existsSync(dir)) return workers;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return workers;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const worker = parseWorkerMarkdown(content, filePath, source);
    if (worker) workers.push(worker);
  }

  return workers;
}

export function discoverWorkers({ cwd, scope = DEFAULT_WORKER_SCOPE, builtinDir, userWorkersDir, projectWorkersDir }) {
  const resolvedUserDir = userWorkersDir ?? path.join(os.homedir(), ".pi", "agent", "workers");
  const resolvedProjectDir = projectWorkersDir ?? findNearestProjectWorkersDir(cwd);

  const sourceOrder = ["builtin"];
  if (scope === "user") sourceOrder.push("user");
  if (scope === "project") sourceOrder.push("project");
  if (scope === "both") sourceOrder.push("user", "project");

  const sourceWorkers = {
    builtin: loadWorkersFromDir(builtinDir, "builtin"),
    user: loadWorkersFromDir(resolvedUserDir, "user"),
    project: loadWorkersFromDir(resolvedProjectDir, "project"),
  };

  const workerMap = new Map();
  for (const source of sourceOrder) {
    for (const worker of sourceWorkers[source] ?? []) {
      workerMap.set(worker.name, worker);
    }
  }

  return {
    workers: Array.from(workerMap.values()),
    builtinDir,
    userWorkersDir: resolvedUserDir,
    projectWorkersDir: resolvedProjectDir,
  };
}

export function formatWorkerSummary(workers) {
  if (!workers.length) return "none";
  return workers
    .map((worker) => {
      const parts = [`${worker.name} (${worker.source})`];
      if (worker.role) parts.push(`role=${worker.role}`);
      if (worker.model) parts.push(`model=${worker.model}`);
      return parts.join(" ");
    })
    .join("; ");
}
