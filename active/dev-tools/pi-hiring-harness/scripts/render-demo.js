#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { aggregateWorkerHistory } from "../lib/history.js";

function usage() {
  console.error("Usage: node scripts/render-demo.js --ledger <ledger.json> --workspace <dir> --output <demo.html> [--title <title>]");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  return `$${value.toFixed(4)}`;
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return String(value);
}

function relativePath(baseDir, targetPath) {
  if (!targetPath) return "";
  return path.relative(baseDir, targetPath) || path.basename(targetPath);
}

function summarizeSelectionReason(selectedApplication) {
  if (!selectedApplication?.application || !selectedApplication?.scoreBreakdown) {
    return "No valid application was selected.";
  }

  const application = selectedApplication.application;
  const score = selectedApplication.scoreBreakdown;
  const reasons = [
    `Predicted success ${formatNumber(score.predictedSuccess)}`,
    `confidence ${formatNumber(score.confidence)}`,
  ];

  if (typeof score.predictedCostUsd === "number") {
    reasons.push(`predicted cost ${formatUsd(score.predictedCostUsd)}`);
  }
  if (score.riskPenalty) {
    reasons.push(`risk penalty ${score.riskPenalty.toFixed(2)}`);
  }
  if (application.risks?.length) {
    reasons.push(`${application.risks.length} declared risk${application.risks.length === 1 ? "" : "s"}`);
  }

  return `${selectedApplication.workerName} ranked first with score ${selectedApplication.scoreBreakdown.score.toFixed(4)} because of ${reasons.join(", ")}.`;
}

function renderKeyValueList(items) {
  return `<dl class="key-value">${items
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("")}</dl>`;
}

function renderList(items, emptyText = "None") {
  if (!items || items.length === 0) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderApplicationCard(applicationResult, selectedWorkerName) {
  const application = applicationResult.application;
  const score = applicationResult.scoreBreakdown;
  const isSelected = applicationResult.workerName === selectedWorkerName;
  const summaryBits = [
    `${applicationResult.workerName}`,
    applicationResult.workerModel,
    score ? `score ${score.score.toFixed(4)}` : "invalid",
  ];

  return `
    <details class="application-card" ${isSelected ? "open" : ""}>
      <summary>
        <span>
          <strong>${escapeHtml(summaryBits.join(" · "))}</strong>
          ${isSelected ? '<span class="pill pill-selected">Selected</span>' : ""}
          ${applicationResult.error ? '<span class="pill pill-error">Invalid resume</span>' : ""}
        </span>
      </summary>
      <div class="card-body">
        ${renderKeyValueList([
          ["Worker", applicationResult.workerName],
          ["Model", applicationResult.workerModel ?? "unknown"],
          ["Source", applicationResult.workerSource],
          ["Resume exit code", String(applicationResult.exitCode ?? "0")],
          ["Resume spend", formatUsd(applicationResult.resumeUsage?.cost)],
          ["Input tokens", formatNumber(applicationResult.resumeUsage?.input)],
          ["Output tokens", formatNumber(applicationResult.resumeUsage?.output)],
        ])}
        ${applicationResult.error ? `<p class="error"><strong>Resume parse error:</strong> ${escapeHtml(applicationResult.error)}</p>` : ""}
        ${application ? `
          <h4>Parsed resume</h4>
          ${renderKeyValueList([
            ["Role", application.roleName ?? "unknown"],
            ["Predicted success", String(application.predictedSuccess ?? "—")],
            ["Confidence", String(application.confidence ?? "—")],
            ["Predicted input tokens", formatNumber(application.predictedInputTokens)],
            ["Predicted output tokens", formatNumber(application.predictedOutputTokens)],
            ["Predicted latency (s)", formatNumber(application.predictedLatencySeconds)],
            ["Max cost", formatUsd(application.maxCostUsd)],
            ["Preferred review", application.preferredReviewLevel ?? "none"],
            ["Evidence source", application.evidenceSource ?? "unknown"],
          ])}
          <h4>Strengths</h4>
          ${renderList(application.relevantStrengths)}
          <h4>Weaknesses</h4>
          ${renderList(application.likelyWeaknesses)}
          <h4>Plan summary</h4>
          <p>${escapeHtml(application.planSummary)}</p>
          <h4>Risks</h4>
          ${renderList(application.risks)}
        ` : ""}
        ${score ? `
          <h4>Score breakdown</h4>
          ${renderKeyValueList([
            ["Final score", score.score.toFixed(4)],
            ["Predicted cost", formatUsd(score.predictedCostUsd)],
            ["Normalized cost", String(score.normalizedCost)],
            ["Risk penalty", String(score.riskPenalty)],
            ["Role bonus", String(score.roleBonus)],
            ["Missing price penalty", String(score.missingPricePenalty)],
          ])}
        ` : ""}
        <h4>Raw resume output</h4>
        <pre>${escapeHtml(applicationResult.rawOutput || "")}</pre>
        ${applicationResult.stderr ? `<h4>stderr</h4><pre>${escapeHtml(applicationResult.stderr)}</pre>` : ""}
      </div>
    </details>
  `;
}

async function listArtifacts(workspaceDir) {
  const artifactPaths = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".pi" || entry.name === "__pycache__") continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        artifactPaths.push(fullPath);
      }
    }
  }

  await walk(workspaceDir);
  artifactPaths.sort();
  return artifactPaths;
}

async function renderArtifactPreview(baseDir, artifactPath) {
  const content = await fs.readFile(artifactPath, "utf-8");
  const relative = relativePath(baseDir, artifactPath);
  const extension = path.extname(artifactPath);
  let preview = content;

  if (extension === ".jsonl") {
    const lines = content.split(/\r?\n/).filter(Boolean);
    preview = lines.slice(0, 20).join("\n");
    if (lines.length > 20) preview += `\n... (${lines.length - 20} more lines)`;
  } else if (content.length > 5000) {
    preview = `${content.slice(0, 5000)}\n\n... truncated ...`;
  }

  return `
    <details class="artifact-card">
      <summary><strong>${escapeHtml(relative)}</strong></summary>
      <div class="card-body">
        <pre>${escapeHtml(preview)}</pre>
      </div>
    </details>
  `;
}

function renderHistoryTable(workerHistory) {
  if (!workerHistory?.length) {
    return '<p class="muted">No shared review history was found yet.</p>';
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Worker</th>
          <th>Applications</th>
          <th>Selections</th>
          <th>Executions</th>
          <th>Validation pass rate</th>
          <th>Review pass rate</th>
          <th>Recent review artifact</th>
        </tr>
      </thead>
      <tbody>
        ${workerHistory.map((history) => `
          <tr>
            <td>${escapeHtml(history.workerName)}</td>
            <td>${history.applications}</td>
            <td>${history.selections}</td>
            <td>${history.executions}</td>
            <td>${history.validationPassRate === null ? '—' : `${Math.round(history.validationPassRate * 100)}%`}</td>
            <td>${history.reviewPassRate === null ? '—' : `${Math.round(history.reviewPassRate * 100)}%`}</td>
            <td>${escapeHtml(history.recentReviews?.[0]?.excerpt || 'No review excerpt yet')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderRecentReviewArtifacts(recentReviews) {
  if (!recentReviews?.length) {
    return '<p class="muted">No prior employee reviews are available for this worker.</p>';
  }
  return recentReviews.map((review, index) => `
    <details class="artifact-card" ${index === 0 ? 'open' : ''}>
      <summary><strong>${escapeHtml(review.savedAt || 'unknown time')}</strong> · verdict=${escapeHtml(review.verdict)} · reviewer=${escapeHtml(review.reviewerWorker || 'unknown')}</summary>
      <div class="card-body">
        ${renderKeyValueList([
          ['Ledger', review.ledgerFile || 'unknown'],
          ['Job id', review.jobId || 'unknown'],
          ['Validation ok', review.validationOk === null ? 'unknown' : String(review.validationOk)],
          ['Verdict', review.verdict || 'unknown'],
        ])}
        <pre>${escapeHtml(review.excerpt || '')}</pre>
      </div>
    </details>
  `).join('\n');
}

function buildHtml({ title, ledgerPath, workspaceDir, payload, artifactPreviews, sharedHistory }) {
  const details = payload.details;
  const summary = payload.summary;
  const job = details.jobs[0];
  const validApplications = job.applications.filter((entry) => entry.application && entry.scoreBreakdown);
  const invalidApplications = job.applications.filter((entry) => entry.error);
  const selectedApplication = job.selectedApplication;
  const sortedApplications = [...job.applications].sort((left, right) => {
    const leftScore = left.scoreBreakdown?.score ?? -Infinity;
    const rightScore = right.scoreBreakdown?.score ?? -Infinity;
    return rightScore - leftScore;
  });
  const reviewRan = Boolean(job.review);
  const validationRan = Boolean(job.validation);
  const selectedWorkerHistory = sharedHistory?.workerHistory?.find((history) => history.workerName === selectedApplication?.workerName && history.workerModel === selectedApplication?.workerModel) ?? null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0b1020;
      --bg-soft: #121933;
      --card: #17203f;
      --border: #2a3768;
      --text: #e7ecff;
      --muted: #9fb0e8;
      --accent: #86b7ff;
      --accent-strong: #5aa0ff;
      --good: #40d394;
      --warn: #ffcc66;
      --bad: #ff7b91;
      --selected: #7dd3fc;
      --shadow: rgba(0, 0, 0, 0.28);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, var(--bg), #0f1530 30%, #0b1020);
      color: var(--text);
      line-height: 1.45;
    }
    a { color: var(--accent); }
    .page {
      max-width: 1220px;
      margin: 0 auto;
      padding: 32px 20px 80px;
    }
    .hero {
      background: radial-gradient(circle at top left, rgba(90,160,255,0.18), transparent 30%), var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 12px 30px var(--shadow);
    }
    h1, h2, h3, h4 { margin-top: 0; }
    .hero p { color: var(--muted); max-width: 80ch; }
    .meta-grid, .stage-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 20px;
    }
    .metric, .stage {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
    }
    .metric .label, .stage .label {
      color: var(--muted);
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .metric .value, .stage .value {
      font-size: 1.2rem;
      font-weight: 700;
      margin-top: 8px;
    }
    .stage .value { font-size: 1rem; }
    .section {
      margin-top: 28px;
      background: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 12px 30px var(--shadow);
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: baseline;
      margin-bottom: 16px;
    }
    .muted { color: var(--muted); }
    .pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.8rem;
      margin-left: 8px;
      border: 1px solid transparent;
    }
    .pill-selected {
      background: rgba(125, 211, 252, 0.16);
      color: var(--selected);
      border-color: rgba(125, 211, 252, 0.4);
    }
    .pill-error {
      background: rgba(255, 123, 145, 0.16);
      color: var(--bad);
      border-color: rgba(255, 123, 145, 0.4);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    details {
      border: 1px solid var(--border);
      border-radius: 16px;
      background: rgba(255,255,255,0.02);
      margin-bottom: 12px;
      overflow: hidden;
    }
    summary {
      cursor: pointer;
      list-style: none;
      padding: 14px 16px;
      background: rgba(255,255,255,0.03);
    }
    summary::-webkit-details-marker { display: none; }
    .card-body {
      padding: 16px;
      border-top: 1px solid var(--border);
    }
    .key-value {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px 16px;
      margin: 0 0 16px;
    }
    .key-value div {
      background: rgba(255,255,255,0.025);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .key-value dt {
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    .key-value dd {
      margin: 0;
      font-weight: 600;
      word-break: break-word;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: #0b1125;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
      overflow: auto;
      font-size: 0.88rem;
    }
    .error {
      color: var(--bad);
      background: rgba(255, 123, 145, 0.08);
      border: 1px solid rgba(255, 123, 145, 0.25);
      border-radius: 12px;
      padding: 12px;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 20px;
    }
    @media (max-width: 900px) {
      .two-col { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p>This demo page shows the full hiring run: the CEO model, candidate pool, parsed resumes, scoring, selected hire, execution outputs, and final artifacts produced in the Pig Latin tiny-LLM test workspace.</p>
      <div class="meta-grid">
        <div class="metric"><div class="label">CEO</div><div class="value">GitHub Copilot · gpt-5.4</div></div>
        <div class="metric"><div class="label">Goal</div><div class="value">Tiny Pig Latin training starter kit</div></div>
        <div class="metric"><div class="label">Candidate hires</div><div class="value">${job.applications.length} OpenRouter free models</div></div>
        <div class="metric"><div class="label">Valid resumes</div><div class="value">${validApplications.length}</div></div>
        <div class="metric"><div class="label">Invalid resumes</div><div class="value">${invalidApplications.length}</div></div>
        <div class="metric"><div class="label">Selected hire</div><div class="value">${escapeHtml(selectedApplication?.workerName ?? "none")}</div></div>
        <div class="metric"><div class="label">Review stage</div><div class="value">${reviewRan ? escapeHtml(job.review.workerName) : "Not run"}</div></div>
        <div class="metric"><div class="label">Validation stage</div><div class="value">${validationRan ? (job.validation.ok ? "Passed" : "Failed") : "Not run"}</div></div>
        <div class="metric"><div class="label">Budget</div><div class="value">${formatUsd(summary.budgetUsd)}</div></div>
        <div class="metric"><div class="label">Ledger</div><div class="value">${escapeHtml(relativePath(workspaceDir, ledgerPath))}</div></div>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h2>Stages of work</h2>
          <p class="muted">A simple narrative of the run from planning to final artifacts.</p>
        </div>
      </div>
      <div class="stage-grid">
        <div class="stage"><div class="label">Stage 1</div><div class="value">CEO received the Pig Latin training-kit goal and a $1.00 budget.</div></div>
        <div class="stage"><div class="label">Stage 2</div><div class="value">19 free OpenRouter worker profiles were loaded as project-local hires.</div></div>
        <div class="stage"><div class="label">Stage 3</div><div class="value">Each candidate submitted a structured resume/application for the same bounded job.</div></div>
        <div class="stage"><div class="label">Stage 4</div><div class="value">The harness parsed and scored resumes using predicted success, confidence, cost, and risk.</div></div>
        <div class="stage"><div class="label">Stage 5</div><div class="value">${escapeHtml(summarizeSelectionReason(selectedApplication))}</div></div>
        <div class="stage"><div class="label">Stage 6</div><div class="value">The selected worker executed the job and produced final workspace files.</div></div>
        <div class="stage"><div class="label">Stage 7</div><div class="value">${validationRan ? `Deterministic validation ${job.validation.ok ? "passed" : "failed"} after checking files and running commands.` : "No deterministic validation was configured for this run."}</div></div>
        <div class="stage"><div class="label">Stage 8</div><div class="value">${reviewRan ? `A reviewer worker (${job.review.workerName}) performed an employee-review pass on the deliverable.` : "No reviewer pass was configured for this run."}</div></div>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h2>Shared employee review history</h2>
          <p class="muted">These review records are aggregated across all persisted hiring runs in this workspace so future CEOs can make better hiring decisions.</p>
        </div>
      </div>
      ${renderHistoryTable(sharedHistory?.workerHistory ?? [])}
      <h3>Selected worker employee record</h3>
      ${selectedWorkerHistory ? renderKeyValueList([
        ['Worker', selectedWorkerHistory.workerName],
        ['Applications', String(selectedWorkerHistory.applications)],
        ['Selections', String(selectedWorkerHistory.selections)],
        ['Executions', String(selectedWorkerHistory.executions)],
        ['Validation passes', String(selectedWorkerHistory.validationsPassed)],
        ['Validation failures', String(selectedWorkerHistory.validationsFailed)],
        ['Review pass rate', selectedWorkerHistory.reviewPassRate === null ? '—' : `${Math.round(selectedWorkerHistory.reviewPassRate * 100)}%`],
      ]) : '<p class="muted">No historical record found for the selected worker.</p>'}
      <h3>Selected worker review artifacts</h3>
      ${renderRecentReviewArtifacts(selectedWorkerHistory?.recentReviews ?? [])}
    </section>

    <section class="section two-col">
      <div>
        <h2>Selection summary</h2>
        ${renderKeyValueList([
          ["Job id", job.job.id],
          ["Objective", job.job.objective],
          ["Acceptance criteria", job.job.acceptanceCriteria],
          ["Selected worker", selectedApplication?.workerName ?? "none"],
          ["Selected model", selectedApplication?.workerModel ?? "none"],
          ["Selected score", selectedApplication?.scoreBreakdown?.score?.toFixed?.(4) ?? "—"],
          ["Predicted selected cost", formatUsd(selectedApplication?.scoreBreakdown?.predictedCostUsd)],
          ["Actual application spend", formatUsd(summary.totals.applicationRoundUsd)],
          ["Actual execution spend", formatUsd(summary.totals.executionRoundUsd)],
          ["Actual validation spend", formatUsd(summary.totals.validationRoundUsd)],
          ["Actual review spend", formatUsd(summary.totals.reviewRoundUsd)],
        ])}
        <h3>Why this worker won</h3>
        <p>${escapeHtml(summarizeSelectionReason(selectedApplication))}</p>
        <h3>Winning plan summary</h3>
        <p>${escapeHtml(selectedApplication?.application?.planSummary ?? "No plan available.")}</p>
        <h3>Winning risks</h3>
        ${renderList(selectedApplication?.application?.risks, "No declared risks")}
      </div>
      <div>
        <h2>Top-ranked candidates</h2>
        <table>
          <thead>
            <tr><th>Rank</th><th>Worker</th><th>Score</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${sortedApplications.slice(0, 10).map((applicationResult, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(applicationResult.workerName)}</td>
                <td>${applicationResult.scoreBreakdown ? applicationResult.scoreBreakdown.score.toFixed(4) : "—"}</td>
                <td>${escapeHtml(applicationResult.error ? `Invalid: ${applicationResult.error}` : applicationResult.workerName === selectedApplication?.workerName ? "Selected" : "Valid")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h2>Resumes / applications</h2>
          <p class="muted">Open each candidate to inspect the parsed application, raw resume JSON, strengths, weaknesses, risks, and score breakdown.</p>
        </div>
      </div>
      ${sortedApplications.map((applicationResult) => renderApplicationCard(applicationResult, selectedApplication?.workerName)).join("\n")}
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h2>Execution and final results</h2>
          <p class="muted">What the selected worker produced in the test workspace.</p>
        </div>
      </div>
      ${job.execution ? renderKeyValueList([
        ["Execution worker", job.execution.workerName],
        ["Execution exit code", String(job.execution.exitCode ?? "0")],
        ["Execution stop reason", job.execution.stopReason ?? "unknown"],
        ["Execution stderr", job.execution.stderr ? "present" : "none"],
      ]) : '<p class="muted">No execution output was captured.</p>'}
      <h3>Captured execution output</h3>
      <pre>${escapeHtml(job.execution?.output || "(The selected worker changed files but returned no text deliverable.)")}</pre>
      <h3>Deterministic validation</h3>
      ${job.validation ? `
        ${renderKeyValueList([
          ["Validation status", job.validation.ok ? "passed" : "failed"],
          ["Required files checked", String(job.validation.summary.requiredFilesChecked)],
          ["Validation commands run", String(job.validation.summary.commandsRun)],
          ["Missing files", String(job.validation.summary.missingFiles)],
          ["Failed commands", String(job.validation.summary.failedCommands)],
        ])}
        ${job.validation.fileChecks?.length ? `<details open><summary><strong>Required file checks</strong></summary><div class="card-body"><pre>${escapeHtml(JSON.stringify(job.validation.fileChecks, null, 2))}</pre></div></details>` : ""}
        ${job.validation.commandResults?.length ? `<details open><summary><strong>Validation commands</strong></summary><div class="card-body"><pre>${escapeHtml(JSON.stringify(job.validation.commandResults, null, 2))}</pre></div></details>` : ""}
      ` : '<p class="muted">No validation was configured for this run.</p>'}
      <h3>Employee review stage</h3>
      ${job.review ? `
        ${renderKeyValueList([
          ["Reviewer", job.review.workerName],
          ["Review exit code", String(job.review.exitCode ?? "0")],
          ["Review stop reason", job.review.stopReason ?? "unknown"],
        ])}
        <pre>${escapeHtml(job.review.output || "")}</pre>
      ` : '<p class="muted">No reviewer stage was run.</p>'}
      <h3>Workspace artifacts</h3>
      ${artifactPreviews.join("\n")}
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h2>Run diagnostics</h2>
          <p class="muted">Useful facts from the live test.</p>
        </div>
      </div>
      <ul>
        <li>The CEO model was <strong>GitHub Copilot gpt-5.4</strong>.</li>
        <li>The candidate pool consisted of <strong>all 19 currently available OpenRouter free models</strong> visible to Pi at test time.</li>
        <li><strong>${validApplications.length}</strong> resumes parsed successfully and <strong>${invalidApplications.length}</strong> failed JSON-format validation.</li>
        <li>The selected worker created <code>pig_latin_dataset.jsonl</code>, <code>train_pig_latin.py</code>, and updated <code>README.md</code>.</li>
        <li>${validationRan ? `Deterministic validation ${job.validation.ok ? "passed" : "failed"}, including file checks and scripted validation commands.` : "No deterministic validation ran in this test."}</li>
        <li>${reviewRan ? `A reviewer stage ran using ${escapeHtml(job.review.workerName)} and produced a textual review of the deliverable.` : "No employee-review stage ran in this test."}</li>
        <li>The generated Python training script passed <code>python -m py_compile</code>.</li>
        <li>The resulting starter kit is useful as a demo, but the dataset quality is mixed: many rows are plain Pig Latin strings instead of explicit source-target training pairs.</li>
      </ul>
    </section>
  </div>
</body>
</html>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.ledger || !options.workspace || !options.output) {
    usage();
    process.exit(1);
  }

  const ledgerPath = path.resolve(options.ledger);
  const workspaceDir = path.resolve(options.workspace);
  const outputPath = path.resolve(options.output);
  const title = options.title || "Pi Hiring Harness Demo";

  const payload = JSON.parse(await fs.readFile(ledgerPath, "utf-8"));
  const sharedHistory = await aggregateWorkerHistory({ cwd: workspaceDir });
  const artifactPaths = await listArtifacts(workspaceDir);
  const artifactPreviews = [];
  for (const artifactPath of artifactPaths) {
    artifactPreviews.push(await renderArtifactPreview(workspaceDir, artifactPath));
  }

  const html = buildHtml({
    title,
    ledgerPath,
    workspaceDir,
    payload,
    artifactPreviews,
    sharedHistory,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, "utf-8");
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
