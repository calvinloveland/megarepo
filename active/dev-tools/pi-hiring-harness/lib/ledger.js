import fs from "node:fs/promises";
import path from "node:path";

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function buildLedgerFileName(now = new Date()) {
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");

  return `${sanitizeSegment(timestamp)}.json`;
}

export function summarizeLedger(details) {
  return {
    mode: details.mode,
    budgetUsd: details.budgetUsd,
    workerScope: details.workerScope,
    totals: details.totals,
    warnings: details.warnings,
    jobs: details.jobs.map((jobResult) => ({
      id: jobResult.job.id,
      objective: jobResult.job.objective,
      selectedWorker: jobResult.selectedApplication?.workerName ?? null,
      selectedScore: jobResult.selectedApplication?.scoreBreakdown?.score ?? null,
      executionWorker: jobResult.execution?.workerName ?? null,
      reviewWorker: jobResult.review?.workerName ?? null,
    })),
  };
}

export async function persistRunLedger({ cwd, details, ledgerDir, now = new Date() }) {
  const resolvedLedgerDir = ledgerDir ?? path.join(cwd, ".pi", "hiring-runs");
  await fs.mkdir(resolvedLedgerDir, { recursive: true });
  const fileName = buildLedgerFileName(now);
  const filePath = path.join(resolvedLedgerDir, fileName);
  const payload = {
    savedAt: now.toISOString(),
    summary: summarizeLedger(details),
    details,
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return filePath;
}

export async function readLatestRunLedger({ cwd, ledgerDir }) {
  const resolvedLedgerDir = ledgerDir ?? path.join(cwd, ".pi", "hiring-runs");
  let entries;
  try {
    entries = await fs.readdir(resolvedLedgerDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) return null;
  const filePath = path.join(resolvedLedgerDir, files[files.length - 1]);
  const content = await fs.readFile(filePath, "utf-8");
  return {
    filePath,
    payload: JSON.parse(content),
  };
}
