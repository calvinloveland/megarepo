import fs from "node:fs/promises";
import path from "node:path";

function defaultHistory(workerName, workerModel, workerRole) {
  return {
    workerName,
    workerModel,
    workerRole,
    applications: 0,
    selections: 0,
    executions: 0,
    validationsPassed: 0,
    validationsFailed: 0,
    reviewedExecutions: 0,
    reviewPasses: 0,
    reviewFailures: 0,
    reviewUnknown: 0,
    performedReviews: 0,
    recentReviews: [],
  };
}

export function buildWorkerHistoryKey(workerName, workerModel) {
  return workerModel || workerName || "unknown-worker";
}

function extractVerdict(reviewOutput) {
  const text = String(reviewOutput || "");
  if (!text.trim()) return "unknown";
  if (/\bpass\b/i.test(text) || /\bmeets? the contract\b/i.test(text)) return "pass";
  if (/\bfail\b/i.test(text) || /\bdoes not meet\b/i.test(text) || /\bblocker/i.test(text)) return "fail";
  return "unknown";
}

function excerpt(text, maxLength = 240) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function pushRecentReview(history, entry, limit = 5) {
  history.recentReviews.unshift(entry);
  if (history.recentReviews.length > limit) {
    history.recentReviews.length = limit;
  }
}

export function summarizeWorkerHistory(history) {
  const validationRate = history.executions > 0
    ? history.validationsPassed / history.executions
    : null;
  const reviewRate = history.reviewedExecutions > 0
    ? history.reviewPasses / history.reviewedExecutions
    : null;

  return {
    ...history,
    validationPassRate: validationRate,
    reviewPassRate: reviewRate,
  };
}

export async function aggregateWorkerHistory({ cwd, ledgerDir } = {}) {
  const resolvedLedgerDir = ledgerDir ?? path.join(cwd ?? process.cwd(), ".pi", "hiring-runs");
  let entries;
  try {
    entries = await fs.readdir(resolvedLedgerDir, { withFileTypes: true });
  } catch {
    return { ledgerDir: resolvedLedgerDir, ledgers: [], workerHistory: [] };
  }

  const ledgerFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(resolvedLedgerDir, entry.name))
    .sort();

  const histories = new Map();

  for (const ledgerFile of ledgerFiles) {
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(ledgerFile, "utf-8"));
    } catch {
      continue;
    }

    const jobs = payload?.details?.jobs ?? [];
    for (const job of jobs) {
      for (const application of job.applications ?? []) {
        const key = buildWorkerHistoryKey(application.workerName, application.workerModel);
        const history = histories.get(key) ?? defaultHistory(application.workerName, application.workerModel, application.workerRole);
        history.applications += 1;
        histories.set(key, history);
      }

      if (job.selectedApplication?.workerName) {
        const key = buildWorkerHistoryKey(job.selectedApplication.workerName, job.selectedApplication.workerModel);
        const history = histories.get(key) ?? defaultHistory(
          job.selectedApplication.workerName,
          job.selectedApplication.workerModel,
          job.selectedApplication.workerRole,
        );
        history.selections += 1;
        histories.set(key, history);
      }

      if (job.execution?.workerName) {
        const key = buildWorkerHistoryKey(job.execution.workerName, job.selectedApplication?.workerModel ?? job.execution.workerModel);
        const history = histories.get(key) ?? defaultHistory(
          job.execution.workerName,
          job.selectedApplication?.workerModel ?? job.execution.workerModel,
          job.selectedApplication?.workerRole,
        );
        history.executions += 1;
        if (job.validation?.ok === true) history.validationsPassed += 1;
        if (job.validation?.ok === false) history.validationsFailed += 1;
        if (job.review) {
          const verdict = extractVerdict(job.review.output);
          history.reviewedExecutions += 1;
          if (verdict === "pass") history.reviewPasses += 1;
          else if (verdict === "fail") history.reviewFailures += 1;
          else history.reviewUnknown += 1;
          pushRecentReview(history, {
            savedAt: payload.savedAt,
            ledgerFile,
            jobId: job.job?.id,
            reviewerWorker: job.review.workerName,
            verdict,
            validationOk: job.validation?.ok ?? null,
            excerpt: excerpt(job.review.output),
          });
        }
        histories.set(key, history);
      }

      if (job.review?.workerName) {
        const key = buildWorkerHistoryKey(job.review.workerName, job.review.workerModel);
        const history = histories.get(key) ?? defaultHistory(job.review.workerName, job.review.workerModel, "reviewer");
        history.performedReviews += 1;
        histories.set(key, history);
      }
    }
  }

  const workerHistory = Array.from(histories.values())
    .map((history) => summarizeWorkerHistory(history))
    .sort((left, right) => {
      const selectionDiff = right.selections - left.selections;
      if (selectionDiff !== 0) return selectionDiff;
      return left.workerName.localeCompare(right.workerName);
    });

  return {
    ledgerDir: resolvedLedgerDir,
    ledgers: ledgerFiles,
    workerHistory,
  };
}
