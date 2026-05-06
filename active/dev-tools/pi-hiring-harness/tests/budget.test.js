import test from "node:test";
import assert from "node:assert/strict";
import { computeActualSpend, computeRemainingBudgetUsd, shouldSkipExecutionForBudget } from "../lib/budget.js";

test("computeActualSpend includes application, execution, review, and validation rounds", () => {
  const total = computeActualSpend({ applicationRoundUsd: 0.1, executionRoundUsd: 0.2, reviewRoundUsd: 0.05, validationRoundUsd: 0.01 });
  assert.equal(total, 0.36);
});

test("computeRemainingBudgetUsd subtracts actual spend from total budget", () => {
  const remaining = computeRemainingBudgetUsd(1.0, { applicationRoundUsd: 0.2, executionRoundUsd: 0.1, reviewRoundUsd: 0.1, validationRoundUsd: 0.05 });
  assert.equal(remaining, 0.55);
});

test("shouldSkipExecutionForBudget blocks predicted over-budget execution", () => {
  const decision = shouldSkipExecutionForBudget({
    totalBudgetUsd: 0.5,
    totals: { applicationRoundUsd: 0.2, executionRoundUsd: 0, reviewRoundUsd: 0, validationRoundUsd: 0 },
    predictedExecutionCostUsd: 0.31,
    enforceBudget: true,
  });

  assert.equal(decision.skip, true);
  assert.match(decision.reason, /exceeds remaining budget/);
});

test("shouldSkipExecutionForBudget allows execution when enforcement is disabled", () => {
  const decision = shouldSkipExecutionForBudget({
    totalBudgetUsd: 0.5,
    totals: { applicationRoundUsd: 0.49, executionRoundUsd: 0, reviewRoundUsd: 0, validationRoundUsd: 0 },
    predictedExecutionCostUsd: 0.1,
    enforceBudget: false,
  });

  assert.equal(decision.skip, false);
});
