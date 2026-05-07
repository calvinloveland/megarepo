import test from "node:test";
import assert from "node:assert/strict";
import { estimateApplicationCostUsd, scoreApplication, scoreWorkerHistory } from "../lib/scoring.js";

test("estimateApplicationCostUsd uses worker pricing when available", () => {
  const cost = estimateApplicationCostUsd(
    { predictedInputTokens: 2000, predictedOutputTokens: 1000 },
    { inputPricePerMillion: 1, outputPricePerMillion: 3 },
  );

  assert.equal(cost, 0.005);
});

test("scoreApplication rewards preferred-role workers with lower normalized cost", () => {
  const preferred = scoreApplication(
    {
      predictedSuccess: 0.8,
      confidence: 0.75,
      predictedInputTokens: 1000,
      predictedOutputTokens: 500,
      risks: ["minor uncertainty"],
    },
    {
      role: "implementer",
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
    },
    {
      preferredRole: "implementer",
      maxBudgetUsd: 0.5,
    },
  );

  const nonPreferred = scoreApplication(
    {
      predictedSuccess: 0.8,
      confidence: 0.75,
      predictedInputTokens: 1000,
      predictedOutputTokens: 500,
      risks: ["minor uncertainty"],
    },
    {
      role: "reviewer",
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
    },
    {
      preferredRole: "implementer",
      maxBudgetUsd: 0.5,
    },
  );

  assert.ok(preferred.score > nonPreferred.score);
});

test("scoreWorkerHistory rewards validated workers and penalizes unreliable ones", () => {
  const strong = scoreWorkerHistory({
    history: {
      executions: 6,
      reviewedExecutions: 6,
      auditedExecutions: 6,
      validationsFailed: 0,
      validationPassRate: 1,
      reviewPassRate: 1,
      averageInputTokenRelativeError: 0.1,
      averageOutputTokenRelativeError: 0.1,
      averageCostRelativeError: 0.1,
      averageSuccessCalibrationGap: 0.1,
    },
  });

  const weak = scoreWorkerHistory({
    history: {
      executions: 6,
      reviewedExecutions: 6,
      auditedExecutions: 6,
      validationsFailed: 5,
      validationPassRate: 0,
      reviewPassRate: 0,
      averageInputTokenRelativeError: 1.5,
      averageOutputTokenRelativeError: 1.2,
      averageCostRelativeError: 1,
      averageSuccessCalibrationGap: 1,
    },
  });

  assert.ok(strong.historyScoreAdjustment > 0);
  assert.ok(weak.historyScoreAdjustment < 0);
  assert.ok(strong.historyScoreAdjustment > weak.historyScoreAdjustment);
});

test("scoreApplication includes worker history in the final hiring score", () => {
  const application = {
    predictedSuccess: 0.72,
    confidence: 0.7,
    predictedInputTokens: 1000,
    predictedOutputTokens: 500,
    risks: ["minor uncertainty"],
  };
  const job = {
    preferredRole: "implementer",
    maxBudgetUsd: 0.5,
  };

  const provenWorker = {
    role: "implementer",
    inputPricePerMillion: 1,
    outputPricePerMillion: 2,
    history: {
      executions: 5,
      reviewedExecutions: 5,
      auditedExecutions: 5,
      validationsFailed: 0,
      validationPassRate: 1,
      reviewPassRate: 0.8,
      averageInputTokenRelativeError: 0.1,
      averageOutputTokenRelativeError: 0.1,
      averageCostRelativeError: 0,
      averageSuccessCalibrationGap: 0.1,
    },
  };

  const unreliableWorker = {
    role: "implementer",
    inputPricePerMillion: 1,
    outputPricePerMillion: 2,
    history: {
      executions: 5,
      reviewedExecutions: 5,
      auditedExecutions: 5,
      validationsFailed: 4,
      validationPassRate: 0.2,
      reviewPassRate: 0.2,
      averageInputTokenRelativeError: 1,
      averageOutputTokenRelativeError: 1,
      averageCostRelativeError: 1,
      averageSuccessCalibrationGap: 1,
    },
  };

  const proven = scoreApplication(application, provenWorker, job);
  const unreliable = scoreApplication(application, unreliableWorker, job);

  assert.ok(proven.historyScoreAdjustment > 0);
  assert.ok(unreliable.historyScoreAdjustment < 0);
  assert.ok(proven.score > unreliable.score);
});
