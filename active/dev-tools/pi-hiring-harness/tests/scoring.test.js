import test from "node:test";
import assert from "node:assert/strict";
import { estimateApplicationCostUsd, scoreApplication } from "../lib/scoring.js";

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
