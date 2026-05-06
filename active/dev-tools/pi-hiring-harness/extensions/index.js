import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { buildApplicationPrompt, buildExecutionPrompt, buildReviewPrompt, parseApplicationResponse } from "../lib/application.js";
import { launchWebpage } from "../lib/browser.js";
import { computeActualSpend, computeRemainingBudgetUsd, shouldSkipExecutionForBudget } from "../lib/budget.js";
import { aggregateWorkerHistory, buildWorkerHistoryKey } from "../lib/history.js";
import { persistRunLedger, readLatestRunLedger } from "../lib/ledger.js";
import { buildJobs } from "../lib/planning.js";
import { estimateApplicationCostUsd, scoreApplication } from "../lib/scoring.js";
import { runWorkerPrompt } from "../lib/subprocess.js";
import { runValidationSuite } from "../lib/validation.js";
import { DEFAULT_WORKER_SCOPE, discoverWorkers, formatWorkerSummary } from "../lib/workers.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtinWorkersDir = path.join(packageRoot, "workers");
const DEFAULT_MAX_CANDIDATES_PER_JOB = 4;
const DEFAULT_REVIEW_MODE = "none";

const OpenInChromeParams = Type.Object({
  url: Type.String({ description: "The URL to open in Chrome." }),
  newWindow: Type.Optional(Type.Boolean({ description: "Open in a new window instead of a new tab.", default: false })),
});

function enumSchema(values, description, defaultValue) {
  return Type.Union(values.map((value) => Type.Literal(value)), {
    description,
    default: defaultValue,
  });
}

function formatUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  return `$${value.toFixed(4)}`;
}

function scoreWorkerMetadata(worker, job) {
  let score = 0;
  if (job.preferredRole && worker.role === job.preferredRole) score += 3;
  else if (!job.preferredRole && worker.role) score += 1;
  if (worker.model) score += 0.5;
  if (typeof worker.inputPricePerMillion === "number" && typeof worker.outputPricePerMillion === "number") score += 0.5;
  if (typeof worker.maxBudgetUsd !== "number" || worker.maxBudgetUsd >= job.maxBudgetUsd) score += 0.25;
  if (worker.source === "user") score += 0.1;
  if (worker.source === "project") score += 0.2;
  if (worker.history?.executions > 0 && typeof worker.history.validationPassRate === "number") {
    score += (worker.history.validationPassRate - 0.5) * 0.8;
  }
  if (worker.history?.reviewedExecutions > 0 && typeof worker.history.reviewPassRate === "number") {
    score += (worker.history.reviewPassRate - 0.5) * 0.4;
  }
  if (worker.history?.validationsFailed > 0) {
    score -= Math.min(worker.history.validationsFailed * 0.1, 0.4);
  }
  return score;
}

function selectCandidatePool(workers, job, maxCandidatesPerJob) {
  return [...workers]
    .sort((left, right) => {
      const rankDifference = scoreWorkerMetadata(right, job) - scoreWorkerMetadata(left, job);
      if (rankDifference !== 0) return rankDifference;
      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(1, maxCandidatesPerJob));
}

function buildSummary(details, maxShownApplications = 3) {
  const lines = [];
  lines.push(`# Hiring run (${details.mode})`);
  lines.push(`- Total budget: ${formatUsd(details.budgetUsd)}`);
  lines.push(`- Worker scope: ${details.workerScope}`);
  lines.push(`- Workers considered: ${details.workerPool.length}`);
  lines.push(`- Resume spend (actual): ${formatUsd(details.totals.applicationRoundUsd)}`);
  if (details.mode === "run") {
    lines.push(`- Execution spend (actual): ${formatUsd(details.totals.executionRoundUsd)}`);
    lines.push(`- Review spend (actual): ${formatUsd(details.totals.reviewRoundUsd)}`);
    lines.push(`- Validation spend (actual): ${formatUsd(details.totals.validationRoundUsd)}`);
  }
  lines.push(`- Predicted selected execution spend: ${formatUsd(details.totals.predictedSelectedSpendUsd)}`);
  lines.push(`- Remaining budget: ${formatUsd(computeRemainingBudgetUsd(details.budgetUsd, details.totals))}`);
  if (details.ledgerPath) {
    lines.push(`- Ledger: ${details.ledgerPath}`);
  }
  if (details.warnings.length > 0) {
    lines.push(`- Warnings: ${details.warnings.join(" | ")}`);
  }

  for (const jobResult of details.jobs) {
    lines.push("");
    lines.push(`## ${jobResult.job.id}`);
    lines.push(`- Objective: ${jobResult.job.objective}`);
    lines.push(`- Budget cap: ${formatUsd(jobResult.job.maxBudgetUsd)}`);
    if (jobResult.selectedApplication) {
      lines.push(
        `- Recommended hire: ${jobResult.selectedApplication.workerName} (${jobResult.selectedApplication.workerSource}) score=${jobResult.selectedApplication.scoreBreakdown.score.toFixed(4)} predicted=${formatUsd(jobResult.selectedApplication.scoreBreakdown.predictedCostUsd)}`,
      );
    } else {
      lines.push(`- Recommended hire: none`);
    }

    if (jobResult.applications.length > 0) {
      lines.push(`- Top applications:`);
      for (const applicationResult of jobResult.applications.slice(0, maxShownApplications)) {
        const parsed = applicationResult.application;
        const status = parsed ? "ok" : `invalid (${applicationResult.error})`;
        const scoreText = applicationResult.scoreBreakdown
          ? applicationResult.scoreBreakdown.score.toFixed(4)
          : "n/a";
        lines.push(
          `  - ${applicationResult.workerName}: ${status}; score=${scoreText}; actual-resume-spend=${formatUsd(applicationResult.resumeUsage.cost)}; predicted-exec=${formatUsd(applicationResult.scoreBreakdown?.predictedCostUsd)}`,
        );
      }
    }

    if (jobResult.executionSkipReason) {
      lines.push(`- Execution skipped: ${jobResult.executionSkipReason}`);
    }

    if (jobResult.execution) {
      lines.push(`- Execution worker: ${jobResult.execution.workerName}`);
      lines.push(`- Execution spend: ${formatUsd(jobResult.execution.usage.cost)}`);
      if (jobResult.execution.output) {
        lines.push(`- Execution output preview: ${jobResult.execution.output.slice(0, 240).replace(/\n+/g, " ")}`);
      }
    }

    if (jobResult.review) {
      lines.push(`- Review worker: ${jobResult.review.workerName}`);
      lines.push(`- Review spend: ${formatUsd(jobResult.review.usage.cost)}`);
      if (jobResult.review.output) {
        lines.push(`- Review output preview: ${jobResult.review.output.slice(0, 240).replace(/\n+/g, " ")}`);
      }
    }

    if (jobResult.validation) {
      lines.push(`- Validation result: ${jobResult.validation.ok ? "passed" : "failed"}`);
      lines.push(`- Required files checked: ${jobResult.validation.summary.requiredFilesChecked}`);
      lines.push(`- Validation commands run: ${jobResult.validation.summary.commandsRun}`);
    }
  }

  return lines.join("\n");
}

async function copyBuiltinWorkers(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(builtinWorkersDir, { withFileTypes: true });
  let created = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const sourcePath = path.join(builtinWorkersDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    try {
      await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
      created += 1;
    } catch (error) {
      if (error && error.code === "EEXIST") skipped += 1;
      else throw error;
    }
  }

  return { created, skipped };
}

const JobSchema = Type.Object({
  id: Type.Optional(Type.String({ description: "Stable id for this job." })),
  objective: Type.String({ description: "The bounded objective for the worker." }),
  acceptanceCriteria: Type.Optional(Type.String({ description: "How the CEO will judge success." })),
  preferredRole: Type.Optional(Type.String({ description: "Preferred worker role, such as researcher or implementer." })),
  requiredFiles: Type.Optional(Type.Array(Type.String({ description: "Files or directories that must exist after execution." }))),
  validationCommands: Type.Optional(Type.Array(Type.String({ description: "Deterministic bash checks run after execution, such as tests or py_compile." }))),
  maxBudgetUsd: Type.Optional(Type.Number({ description: "Optional explicit budget cap for this job." })),
  cwd: Type.Optional(Type.String({ description: "Optional working directory for this job." })),
});

function pickReviewWorker(workerPool, reviewerWorkerName) {
  if (reviewerWorkerName) {
    return workerPool.find((worker) => worker.name === reviewerWorkerName) ?? null;
  }
  return workerPool.find((worker) => worker.role === "reviewer") ?? null;
}

const HireWorkersParams = Type.Object({
  objective: Type.Optional(Type.String({ description: "High-level objective. Used as a single job when jobs[] is omitted." })),
  jobs: Type.Optional(Type.Array(JobSchema, { description: "Bounded jobs for the hiring round." })),
  budgetUsd: Type.Number({ description: "Maximum total budget for this hiring run in USD." }),
  mode: Type.Optional(enumSchema(["plan", "run"], "Plan only or plan and execute selected hires.", "plan")),
  workerScope: Type.Optional(
    enumSchema(
      ["user", "project", "both"],
      'Builtin workers are always included. "user" adds ~/.pi/agent/workers, "project" adds .pi/workers, and "both" adds both.',
      DEFAULT_WORKER_SCOPE,
    ),
  ),
  confirmProjectWorkers: Type.Optional(
    Type.Boolean({ description: "Prompt before using project-local workers when UI is available.", default: true }),
  ),
  workerNames: Type.Optional(Type.Array(Type.String({ description: "Optional allowlist of worker names." }))),
  maxCandidatesPerJob: Type.Optional(
    Type.Integer({ description: "Maximum number of workers to solicit per job after metadata prefiltering.", default: DEFAULT_MAX_CANDIDATES_PER_JOB, minimum: 1, maximum: 64 }),
  ),
  enforceBudget: Type.Optional(
    Type.Boolean({ description: "When true, skip execution if the predicted selected hire would exceed the remaining budget.", default: true }),
  ),
  persistLedger: Type.Optional(
    Type.Boolean({ description: "Persist the full hiring ledger to .pi/hiring-runs or a custom ledgerDir.", default: true }),
  ),
  ledgerDir: Type.Optional(Type.String({ description: "Optional directory for persisted hiring ledgers." })),
  reviewMode: Type.Optional(
    enumSchema(["none", "selected"], 'Whether to run a reviewer after each executed hire. "selected" uses reviewerWorkerName or the first worker with role=reviewer.', DEFAULT_REVIEW_MODE),
  ),
  reviewerWorkerName: Type.Optional(Type.String({ description: "Optional reviewer worker name to use when reviewMode is selected." })),
  cwd: Type.Optional(Type.String({ description: "Fallback working directory for subprocess workers." })),
});

export default function registerHiringHarness(pi) {
  pi.registerTool({
    name: "open_in_chrome",
    label: "Open in Chrome",
    description: "Open a URL directly in Google Chrome or a Chrome-compatible browser on this machine.",
    parameters: OpenInChromeParams,
    async execute(_toolCallId, params) {
      const launch = launchWebpage(params.url, { newWindow: params.newWindow ?? false });
      return {
        content: [{ type: "text", text: `Opened ${launch.url} with ${launch.executable}.` }],
        details: launch,
      };
    },
  });

  pi.registerTool({
    name: "hire_workers",
    label: "Hire Workers",
    description: [
      "Run a budget-aware hiring round for specialist worker agents.",
      "The current Pi model acts as the CEO, while worker subprocesses apply for jobs with structured cost and capability claims.",
      "Can optionally execute the winning hire for each job and return a run ledger with actual spend.",
    ].join(" "),
    parameters: HireWorkersParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const mode = params.mode ?? "plan";
      const workerScope = params.workerScope ?? DEFAULT_WORKER_SCOPE;
      const confirmProjectWorkers = params.confirmProjectWorkers ?? true;
      const enforceBudget = params.enforceBudget ?? true;
      const persistLedger = params.persistLedger ?? true;
      const reviewMode = params.reviewMode ?? DEFAULT_REVIEW_MODE;
      const defaultCwd = params.cwd ?? ctx.cwd;
      const jobs = buildJobs({
        objective: params.objective,
        jobs: params.jobs,
        totalBudgetUsd: params.budgetUsd,
      });

      if (jobs.length === 0) {
        return {
          content: [{ type: "text", text: "Provide either objective or jobs." }],
          details: {
            mode,
            budgetUsd: params.budgetUsd,
            workerScope,
            workerPool: [],
            jobs: [],
            totals: { applicationRoundUsd: 0, executionRoundUsd: 0, reviewRoundUsd: 0, validationRoundUsd: 0, predictedSelectedSpendUsd: 0 },
            warnings: ["No jobs were provided."],
            ledgerPath: null,
          },
        };
      }

      const discovery = discoverWorkers({ cwd: defaultCwd, scope: workerScope, builtinDir: builtinWorkersDir });
      const historySnapshot = await aggregateWorkerHistory({ cwd: defaultCwd, ledgerDir: params.ledgerDir });
      const historyByWorkerKey = new Map(
        historySnapshot.workerHistory.map((history) => [buildWorkerHistoryKey(history.workerName, history.workerModel), history]),
      );
      let workerPool = discovery.workers.map((worker) => ({
        ...worker,
        history: historyByWorkerKey.get(buildWorkerHistoryKey(worker.name, worker.model)),
      }));

      if (Array.isArray(params.workerNames) && params.workerNames.length > 0) {
        const allowedNames = new Set(params.workerNames);
        workerPool = workerPool.filter((worker) => allowedNames.has(worker.name));
      }

      if (workerPool.length === 0) {
        return {
          content: [{ type: "text", text: "No worker profiles were found. Run /hiring-init and customize .pi/workers/*.md." }],
          details: {
            mode,
            budgetUsd: params.budgetUsd,
            workerScope,
            workerPool: [],
            jobs: [],
            totals: { applicationRoundUsd: 0, executionRoundUsd: 0, reviewRoundUsd: 0, validationRoundUsd: 0, predictedSelectedSpendUsd: 0 },
            warnings: ["No worker profiles were available."],
            ledgerPath: null,
          },
        };
      }

      if ((workerScope === "project" || workerScope === "both") && confirmProjectWorkers && ctx.hasUI) {
        const requestedProjectWorkers = workerPool.filter((worker) => worker.source === "project");
        if (requestedProjectWorkers.length > 0) {
          const approved = await ctx.ui.confirm(
            "Use project-local workers?",
            `Workers: ${requestedProjectWorkers.map((worker) => worker.name).join(", ")}\nSource: ${discovery.projectWorkersDir ?? "(unknown)"}\n\nProject workers are repo-controlled prompts. Continue only if you trust this repository.`,
          );
          if (!approved) {
            return {
              content: [{ type: "text", text: "Canceled: project-local workers were not approved." }],
              details: {
                mode,
                budgetUsd: params.budgetUsd,
                workerScope,
                workerPool,
                jobs: [],
                totals: { applicationRoundUsd: 0, executionRoundUsd: 0, reviewRoundUsd: 0, validationRoundUsd: 0, predictedSelectedSpendUsd: 0 },
                warnings: ["Project-local workers were not approved."],
                ledgerPath: null,
              },
            };
          }
        }
      }

      const details = {
        mode,
        budgetUsd: params.budgetUsd,
        workerScope,
        enforceBudget,
        reviewMode,
        workerPool: workerPool.map((worker) => ({
          name: worker.name,
          role: worker.role,
          source: worker.source,
          model: worker.model,
          filePath: worker.filePath,
          inputPricePerMillion: worker.inputPricePerMillion,
          outputPricePerMillion: worker.outputPricePerMillion,
          history: worker.history ?? null,
        })),
        workerSummary: formatWorkerSummary(workerPool),
        jobs: [],
        totals: {
          applicationRoundUsd: 0,
          executionRoundUsd: 0,
          reviewRoundUsd: 0,
          validationRoundUsd: 0,
          predictedSelectedSpendUsd: 0,
        },
        warnings: [],
        ledgerPath: null,
        sharedWorkerHistory: historySnapshot,
      };

      if (workerPool.every((worker) => worker.source === "builtin")) {
        details.warnings.push("Only builtin starter workers were available. Customize .pi/workers for real model and pricing control.");
      }

      const emitUpdate = () => {
        if (!onUpdate) return;
        onUpdate({
          content: [{ type: "text", text: buildSummary(details) }],
          details,
        });
      };

      const maxCandidatesPerJob = params.maxCandidatesPerJob ?? DEFAULT_MAX_CANDIDATES_PER_JOB;

      for (const job of jobs) {
        const candidateWorkers = selectCandidatePool(workerPool, job, maxCandidatesPerJob);
        const jobResult = {
          job,
          candidateWorkers: candidateWorkers.map((worker) => ({
            name: worker.name,
            role: worker.role,
            source: worker.source,
            model: worker.model,
          })),
          applications: [],
          selectedApplication: null,
          executionSkipReason: null,
          execution: null,
          review: null,
          validation: null,
        };
        details.jobs.push(jobResult);
        emitUpdate();

        for (const worker of candidateWorkers) {
          const prompt = buildApplicationPrompt({ job, worker, totalBudgetUsd: params.budgetUsd });
          const resumeRun = await runWorkerPrompt({ defaultCwd, worker, prompt, cwd: job.cwd, signal });
          details.totals.applicationRoundUsd += resumeRun.usage.cost;

          const applicationResult = {
            workerName: worker.name,
            workerSource: worker.source,
            workerRole: worker.role,
            workerModel: worker.model,
            resumeUsage: resumeRun.usage,
            rawOutput: resumeRun.finalOutput,
            exitCode: resumeRun.exitCode,
            stderr: resumeRun.stderr,
            application: null,
            scoreBreakdown: null,
            error: null,
          };

          if (resumeRun.exitCode !== 0) {
            applicationResult.error = `worker exited with code ${resumeRun.exitCode}`;
          }

          try {
            const application = parseApplicationResponse(resumeRun.finalOutput, worker);
            const scoreBreakdown = scoreApplication(application, worker, job);
            applicationResult.application = application;
            applicationResult.scoreBreakdown = scoreBreakdown;
          } catch (error) {
            applicationResult.error = error instanceof Error ? error.message : String(error);
          }

          jobResult.applications.push(applicationResult);
          emitUpdate();
        }

        jobResult.applications.sort((left, right) => {
          const leftScore = left.scoreBreakdown?.score ?? -Infinity;
          const rightScore = right.scoreBreakdown?.score ?? -Infinity;
          return rightScore - leftScore;
        });

        const selectedApplication = jobResult.applications.find((applicationResult) => applicationResult.application && applicationResult.scoreBreakdown) ?? null;
        jobResult.selectedApplication = selectedApplication;
        if (selectedApplication?.scoreBreakdown?.predictedCostUsd !== undefined) {
          details.totals.predictedSelectedSpendUsd += selectedApplication.scoreBreakdown.predictedCostUsd;
        } else if (selectedApplication?.application) {
          const worker = candidateWorkers.find((candidate) => candidate.name === selectedApplication.workerName);
          const estimatedCost = estimateApplicationCostUsd(selectedApplication.application, worker);
          if (estimatedCost !== undefined) {
            details.totals.predictedSelectedSpendUsd += estimatedCost;
          }
        }

        emitUpdate();
      }

      if (mode === "run") {
        const reviewWorker = reviewMode === "selected" ? pickReviewWorker(workerPool, params.reviewerWorkerName) : null;
        if (reviewMode === "selected" && !reviewWorker) {
          details.warnings.push("Review mode was requested, but no reviewer worker was available.");
        }

        for (const jobResult of details.jobs) {
          if (!jobResult.selectedApplication?.application) continue;
          const worker = workerPool.find((candidate) => candidate.name === jobResult.selectedApplication.workerName);
          if (!worker) continue;

          const budgetDecision = shouldSkipExecutionForBudget({
            totalBudgetUsd: params.budgetUsd,
            totals: details.totals,
            predictedExecutionCostUsd: jobResult.selectedApplication.scoreBreakdown?.predictedCostUsd,
            enforceBudget,
          });

          if (budgetDecision.skip) {
            jobResult.executionSkipReason = budgetDecision.reason;
            details.warnings.push(`Skipped ${jobResult.job.id}: ${budgetDecision.reason}`);
            emitUpdate();
            continue;
          }

          const executionPrompt = buildExecutionPrompt({
            job: jobResult.job,
            selectedApplication: jobResult.selectedApplication.application,
          });

          const executionRun = await runWorkerPrompt({
            defaultCwd,
            worker,
            prompt: executionPrompt,
            cwd: jobResult.job.cwd,
            signal,
            onUpdate: () => emitUpdate(),
          });

          details.totals.executionRoundUsd += executionRun.usage.cost;
          jobResult.execution = {
            workerName: worker.name,
            workerModel: worker.model,
            workerSource: worker.source,
            output: executionRun.finalOutput,
            usage: executionRun.usage,
            exitCode: executionRun.exitCode,
            stopReason: executionRun.stopReason,
            errorMessage: executionRun.errorMessage,
            stderr: executionRun.stderr,
          };
          emitUpdate();

          if ((jobResult.job.requiredFiles?.length ?? 0) > 0 || (jobResult.job.validationCommands?.length ?? 0) > 0) {
            jobResult.validation = await runValidationSuite({
              requiredFiles: jobResult.job.requiredFiles,
              validationCommands: jobResult.job.validationCommands,
              cwd: jobResult.job.cwd,
              fallbackCwd: defaultCwd,
              signal,
            });
            emitUpdate();
          }

          if (reviewWorker && (executionRun.finalOutput || jobResult.validation)) {
            const reviewPrompt = buildReviewPrompt({
              job: jobResult.job,
              selectedApplication: jobResult.selectedApplication.application,
              executionOutput: `${executionRun.finalOutput || "(no execution text returned)"}\n\nValidation summary: ${jobResult.validation ? JSON.stringify(jobResult.validation.summary) : "no validation run"}`,
            });
            const reviewRun = await runWorkerPrompt({
              defaultCwd,
              worker: reviewWorker,
              prompt: reviewPrompt,
              cwd: jobResult.job.cwd,
              signal,
            });
            details.totals.reviewRoundUsd += reviewRun.usage.cost;
            jobResult.review = {
              workerName: reviewWorker.name,
              workerModel: reviewWorker.model,
              workerSource: reviewWorker.source,
              output: reviewRun.finalOutput,
              usage: reviewRun.usage,
              exitCode: reviewRun.exitCode,
              stopReason: reviewRun.stopReason,
              errorMessage: reviewRun.errorMessage,
              stderr: reviewRun.stderr,
            };
            emitUpdate();
          }
        }
      }

      const actualTotalSpend = computeActualSpend(details.totals);
      if (actualTotalSpend > params.budgetUsd) {
        details.warnings.push(
          `Actual spend ${formatUsd(actualTotalSpend)} exceeded stated budget ${formatUsd(params.budgetUsd)} during this run.`,
        );
      }
      if (details.totals.predictedSelectedSpendUsd > params.budgetUsd) {
        details.warnings.push(
          `Predicted selected execution spend ${formatUsd(details.totals.predictedSelectedSpendUsd)} is above the total run budget.`,
        );
      }

      if (persistLedger) {
        try {
          details.ledgerPath = await persistRunLedger({
            cwd: defaultCwd,
            details,
            ledgerDir: params.ledgerDir,
          });
        } catch (error) {
          details.warnings.push(`Failed to persist hiring ledger: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return {
        content: [{ type: "text", text: buildSummary(details) }],
        details,
      };
    },
  });

  pi.registerCommand("hiring-init", {
    description: "Scaffold starter worker profiles into .pi/workers",
    handler: async (_args, ctx) => {
      const targetDir = path.join(ctx.cwd, ".pi", "workers");
      const { created, skipped } = await copyBuiltinWorkers(targetDir);
      ctx.ui.notify(`Worker scaffolding complete: created ${created}, skipped ${skipped} in ${targetDir}`, "info");
    },
  });

  pi.registerCommand("hiring-workers", {
    description: "List builtin, user, and project worker profiles visible from the current cwd",
    handler: async (_args, ctx) => {
      const discovery = discoverWorkers({ cwd: ctx.cwd, scope: "both", builtinDir: builtinWorkersDir });
      const lines = [
        `Workers: ${discovery.workers.length}`,
        `Builtin dir: ${builtinWorkersDir}`,
        `User dir: ${discovery.userWorkersDir}`,
        `Project dir: ${discovery.projectWorkersDir ?? "(none)"}`,
        "",
        ...discovery.workers.map((worker) => {
          const details = [`- ${worker.name} (${worker.source})`];
          if (worker.role) details.push(`role=${worker.role}`);
          if (worker.model) details.push(`model=${worker.model}`);
          if (worker.tools?.length) details.push(`tools=${worker.tools.join(",")}`);
          return details.join(" ");
        }),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("hiring-last-run", {
    description: "Show the latest persisted hiring ledger summary",
    handler: async (_args, ctx) => {
      const latest = await readLatestRunLedger({ cwd: ctx.cwd });
      if (!latest) {
        ctx.ui.notify("No persisted hiring ledger was found under .pi/hiring-runs", "info");
        return;
      }

      const summary = latest.payload?.summary;
      const lines = [
        `Ledger: ${latest.filePath}`,
        `Mode: ${summary?.mode ?? "unknown"}`,
        `Budget: ${formatUsd(summary?.budgetUsd)}`,
        `Worker scope: ${summary?.workerScope ?? "unknown"}`,
        `Warnings: ${(summary?.warnings ?? []).length}`,
        "",
        ...((summary?.jobs ?? []).map((job) => `- ${job.id}: selected=${job.selectedWorker ?? "none"} execution=${job.executionWorker ?? "none"} review=${job.reviewWorker ?? "none"}`)),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("open-url", {
    description: "Open a URL in Chrome",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /open-url <url>", "warning");
        return;
      }
      const launch = launchWebpage(args.trim());
      ctx.ui.notify(`Opened ${launch.url} with ${launch.executable}`, "info");
    },
  });
}
