import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aggregateWorkerHistory } from "../lib/history.js";

async function writeLedger(root, fileName, payload) {
  const dir = path.join(root, ".pi", "hiring-runs");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

test("aggregateWorkerHistory combines validation and review outcomes across runs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-hiring-history-test-"));

  await writeLedger(tempRoot, "20260506-120000.json", {
    savedAt: "2026-05-06T12:00:00Z",
    details: {
      jobs: [
        {
          applications: [
            { workerName: "implementer-a", workerModel: "openrouter/foo-a", workerRole: "implementer" },
            { workerName: "reviewer-a", workerModel: "openrouter/reviewer", workerRole: "reviewer" },
          ],
          selectedApplication: { workerName: "implementer-a", workerModel: "openrouter/foo-a", workerRole: "implementer" },
          execution: { workerName: "implementer-a", usage: { input: 120, output: 50, cost: 0.08 } },
          validation: { ok: true },
          review: { workerName: "reviewer-a", workerModel: "openrouter/reviewer", output: "PASS - meets the contract" },
          employeeReviewAudit: { errors: { inputTokensRelative: 0.2, outputTokensRelative: 0.1, costRelative: 0.2 }, successCalibrationGap: 0.1, summary: "audit one" },
          job: { id: "job-1" },
        },
      ],
    },
  });

  await writeLedger(tempRoot, "20260506-130000.json", {
    savedAt: "2026-05-06T13:00:00Z",
    details: {
      jobs: [
        {
          applications: [
            { workerName: "implementer-a", workerModel: "openrouter/foo-a", workerRole: "implementer" },
          ],
          selectedApplication: { workerName: "implementer-a", workerModel: "openrouter/foo-a", workerRole: "implementer" },
          execution: { workerName: "implementer-a", usage: { input: 100, output: 40, cost: 0.05 } },
          validation: { ok: false },
          review: { workerName: "reviewer-a", workerModel: "openrouter/reviewer", output: "FAIL - blocker found" },
          employeeReviewAudit: { errors: { inputTokensRelative: 0.4, outputTokensRelative: 0.3, costRelative: 0.1 }, successCalibrationGap: 0.4, summary: "audit two" },
          job: { id: "job-2" },
        },
      ],
    },
  });

  const history = await aggregateWorkerHistory({ cwd: tempRoot });
  const implementer = history.workerHistory.find((entry) => entry.workerName === "implementer-a");
  const reviewer = history.workerHistory.find((entry) => entry.workerName === "reviewer-a");

  assert.equal(implementer.applications, 2);
  assert.equal(implementer.executions, 2);
  assert.equal(implementer.validationsPassed, 1);
  assert.equal(implementer.validationsFailed, 1);
  assert.equal(implementer.reviewedExecutions, 2);
  assert.equal(implementer.reviewPasses, 1);
  assert.equal(implementer.reviewFailures, 1);
  assert.equal(reviewer.performedReviews, 2);
  assert.equal(implementer.recentReviews.length, 2);
  assert.equal(implementer.averageInputTokenRelativeError, 0.3);
  assert.equal(implementer.averageOutputTokenRelativeError, 0.2);
  assert.equal(implementer.averageCostRelativeError, 0.15);
  assert.equal(implementer.averageSuccessCalibrationGap, 0.25);
  assert.equal(implementer.recentReviews[0].auditSummary, "audit two");
});
