function roundUsd(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

export function computeActualSpend(totals) {
  return roundUsd((totals?.applicationRoundUsd ?? 0) + (totals?.executionRoundUsd ?? 0) + (totals?.reviewRoundUsd ?? 0));
}

export function computeRemainingBudgetUsd(totalBudgetUsd, totals) {
  return roundUsd(Number(totalBudgetUsd || 0) - computeActualSpend(totals));
}

export function shouldSkipExecutionForBudget({
  totalBudgetUsd,
  totals,
  predictedExecutionCostUsd,
  enforceBudget = true,
}) {
  const remainingBudgetUsd = computeRemainingBudgetUsd(totalBudgetUsd, totals);
  if (!enforceBudget) {
    return { skip: false, remainingBudgetUsd };
  }

  if (remainingBudgetUsd <= 0) {
    return {
      skip: true,
      remainingBudgetUsd,
      reason: `No remaining budget is available for execution. Remaining budget: $${remainingBudgetUsd.toFixed(4)}`,
    };
  }

  if (typeof predictedExecutionCostUsd === "number" && predictedExecutionCostUsd > remainingBudgetUsd) {
    return {
      skip: true,
      remainingBudgetUsd,
      reason: `Predicted execution cost $${predictedExecutionCostUsd.toFixed(4)} exceeds remaining budget $${remainingBudgetUsd.toFixed(4)}.`,
    };
  }

  return { skip: false, remainingBudgetUsd };
}
