import test from "node:test";
import assert from "node:assert/strict";
import { buildEmployeeReviewAudit, extractReviewVerdict } from "../lib/audit.js";

test("extractReviewVerdict understands pass and fail language", () => {
  assert.equal(extractReviewVerdict("PASS - meets the contract"), "pass");
  assert.equal(extractReviewVerdict("FAIL - blocker found"), "fail");
  assert.equal(extractReviewVerdict("unclear"), "unknown");
});

test("buildEmployeeReviewAudit compares predicted and actual execution stats", () => {
  const audit = buildEmployeeReviewAudit({
    selectedApplication: {
      application: {
        predictedInputTokens: 100,
        predictedOutputTokens: 50,
        predictedLatencySeconds: 10,
        predictedSuccess: 0.8,
        confidence: 0.9,
        maxCostUsd: 0.1,
      },
      scoreBreakdown: {
        predictedCostUsd: 0.1,
      },
    },
    execution: {
      durationSeconds: 12,
      usage: {
        input: 120,
        output: 40,
        cost: 0.08,
      },
    },
    validation: { ok: true },
    review: { output: "PASS - meets the contract" },
  });

  assert.equal(audit.actual.reviewVerdict, "pass");
  assert.equal(audit.actual.validationOk, true);
  assert.equal(audit.errors.inputTokensRelative, 0.2);
  assert.equal(audit.errors.outputTokensRelative, 0.2);
  assert.equal(audit.errors.costRelative, 0.2);
  assert.equal(audit.successCalibrationGap, 0.2);
  assert.match(audit.summary, /input tokens predicted 100, actual 120/);
});
