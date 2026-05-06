import test from "node:test";
import assert from "node:assert/strict";
import { computeActualSpend, computeRemainingBudgetUsd, shouldSkipExecutionForBudget } from "../lib/budget.js";

test("computeActualSpend includes application, execution, and review rounds", () => {
  const total = computeActualSpend({ applicationRoundUsd: 0.1, executionRoundUsd: 0.2, reviewRoundUsd: 0.05 });
  assert.equal(total, 0.35);
});

test("computeRemainingBudgetUsd subtracts actual spend from total budget", () => {
  const remaining = computeRemainingBudgetUsd(1.0, { applicationRoundUsd: 0.2, executionRoundUsd: 0.1, reviewRoundUsd: 0.1 });
  assert.equal(remaining, 0.6);
});

test("shouldSkipExecutionForBudget blocks predicted over-budget execution", () => {
  const decision = shouldSkipExecutionForBudget({
    totalBudgetUsd: 0.5,
    totals: { applicationRoundUsd: 0.2, executionRoundUsd: 0, reviewRoundUsd: 0 },
    predictedExecutionCostUsd: 0.31,
    enforceBudget: true,
  });

  assert.equal(decision.skip, true);
  assert.match(decision.reason, /exceeds remaining budget/);
});

test("shouldSkipExecutionForBudget allows execution when enforcement is disabled", () => {
  const decision = shouldSkipExecutionForBudget({
    totalBudgetUsd: 0.5,
    totals: { applicationRoundUsd: 0.49, executionRoundUsd: 0, reviewRoundUsd: 0 },
    predictedExecutionCostUsd: 0.1,
    enforceBudget: false,
  });

  assert.equal(decision.skip, false);
});
