function clamp01(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

export function estimateApplicationCostUsd(application, worker) {
  const inputTokens = Number(application?.predictedInputTokens ?? 0);
  const outputTokens = Number(application?.predictedOutputTokens ?? 0);
  const inputPrice = Number(worker?.inputPricePerMillion ?? 0);
  const outputPrice = Number(worker?.outputPricePerMillion ?? 0);

  const pricedCost = (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
  if (pricedCost > 0) {
    return Math.round(pricedCost * 10000) / 10000;
  }

  if (Number.isFinite(Number(application?.maxCostUsd))) {
    return Math.round(Number(application.maxCostUsd) * 10000) / 10000;
  }

  return undefined;
}

export function scoreApplication(application, worker, job) {
  const predictedSuccess = clamp01(application?.predictedSuccess, 0.5);
  const confidence = clamp01(application?.confidence, predictedSuccess);
  const predictedCostUsd = estimateApplicationCostUsd(application, worker);
  const budgetUsd = Number(job?.maxBudgetUsd ?? 0);
  const normalizedCost = predictedCostUsd !== undefined && budgetUsd > 0
    ? Math.min(predictedCostUsd / budgetUsd, 2)
    : 1;
  const riskPenalty = Math.min((application?.risks?.length ?? 0) * 0.05, 0.25);
  const roleBonus = job?.preferredRole && worker?.role === job.preferredRole ? 0.08 : 0;
  const missingPricePenalty = predictedCostUsd === undefined ? 0.05 : 0;

  const score = predictedSuccess * 0.55 + confidence * 0.25 + roleBonus - normalizedCost * 0.25 - riskPenalty - missingPricePenalty;

  return {
    score: Math.round(score * 10000) / 10000,
    predictedCostUsd,
    predictedSuccess,
    confidence,
    normalizedCost,
    riskPenalty,
    roleBonus,
    missingPricePenalty,
  };
}
