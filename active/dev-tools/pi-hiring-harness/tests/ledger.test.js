import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildLedgerFileName, persistRunLedger, readLatestRunLedger, summarizeLedger } from "../lib/ledger.js";

test("buildLedgerFileName is stable and timestamp-based", () => {
  const fileName = buildLedgerFileName(new Date("2026-05-06T12:34:56Z"));
  assert.equal(fileName, "20260506-123456.json");
});

test("summarizeLedger extracts compact job info", () => {
  const summary = summarizeLedger({
    mode: "run",
    budgetUsd: 1,
    workerScope: "both",
    totals: { applicationRoundUsd: 0.1, executionRoundUsd: 0.2, reviewRoundUsd: 0.05, predictedSelectedSpendUsd: 0.25 },
    warnings: ["one"],
    jobs: [
      {
        job: { id: "patch", objective: "Patch parser" },
        selectedApplication: { workerName: "implementer", scoreBreakdown: { score: 0.8 } },
        execution: { workerName: "implementer" },
        review: { workerName: "reviewer" },
      },
    ],
  });

  assert.equal(summary.jobs[0].selectedWorker, "implementer");
  assert.equal(summary.jobs[0].reviewWorker, "reviewer");
});

test("persistRunLedger writes a readable JSON artifact and readLatestRunLedger finds it", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-hiring-ledger-test-"));
  const details = {
    mode: "plan",
    budgetUsd: 0.8,
    workerScope: "user",
    totals: { applicationRoundUsd: 0.1, executionRoundUsd: 0, reviewRoundUsd: 0, predictedSelectedSpendUsd: 0.2 },
    warnings: [],
    jobs: [],
  };

  const filePath = await persistRunLedger({
    cwd: tempRoot,
    details,
    now: new Date("2026-05-06T12:34:56Z"),
  });

  assert.ok(filePath.endsWith(path.join(".pi", "hiring-runs", "20260506-123456.json")));

  const latest = await readLatestRunLedger({ cwd: tempRoot });
  assert.equal(latest.filePath, filePath);
  assert.equal(latest.payload.details.mode, "plan");
});
