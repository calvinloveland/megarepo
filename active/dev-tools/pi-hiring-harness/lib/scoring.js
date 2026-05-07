function clamp01(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function maybeRate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp01(parsed) : null;
}

function evidenceWeight(value, fullWeightAt = 5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed / fullWeightAt, 1);
}

export function scoreWorkerHistory(worker) {
  const history = worker?.history;
  if (!history) {
    return {
      historyScoreAdjustment: 0,
      validationHistoryBonus: 0,
      reviewHistoryBonus: 0,
      estimateAccuracyPenalty: 0,
      deliveryPenalty: 0,
      evidenceWeight: 0,
    };
  }

  const executions = Number(history.executions ?? 0);
  const reviewedExecutions = Number(history.reviewedExecutions ?? 0);
  const auditedExecutions = Number(history.auditedExecutions ?? 0);
  const validationPassRate = maybeRate(history.validationPassRate);
  const reviewPassRate = maybeRate(history.reviewPassRate);
  const validationEvidence = evidenceWeight(executions);
  const reviewEvidence = evidenceWeight(reviewedExecutions);
  const auditEvidence = evidenceWeight(auditedExecutions);

  const validationHistoryBonus = validationPassRate === null
    ? 0
    : (validationPassRate - 0.5) * 0.36 * validationEvidence;
  const reviewHistoryBonus = reviewPassRate === null
    ? 0
    : (reviewPassRate - 0.5) * 0.24 * reviewEvidence;

  const averageInputTokenRelativeError = clamp01(history.averageInputTokenRelativeError, 1);
  const averageOutputTokenRelativeError = clamp01(history.averageOutputTokenRelativeError, 1);
  const averageCostRelativeError = clamp01(history.averageCostRelativeError, 1);
  const averageSuccessCalibrationGap = clamp01(history.averageSuccessCalibrationGap, 1);

  const estimateAccuracyPenalty = auditEvidence * (
    averageInputTokenRelativeError * 0.06
    + averageOutputTokenRelativeError * 0.05
    + averageCostRelativeError * 0.03
    + averageSuccessCalibrationGap * 0.06
  );

  const deliveryPenalty = validationEvidence * Math.min(Number(history.validationsFailed ?? 0) * 0.02, 0.08);
  const historyScoreAdjustment = validationHistoryBonus + reviewHistoryBonus - estimateAccuracyPenalty - deliveryPenalty;

  return {
    historyScoreAdjustment: Math.round(historyScoreAdjustment * 10000) / 10000,
    validationHistoryBonus: Math.round(validationHistoryBonus * 10000) / 10000,
    reviewHistoryBonus: Math.round(reviewHistoryBonus * 10000) / 10000,
    estimateAccuracyPenalty: Math.round(estimateAccuracyPenalty * 10000) / 10000,
    deliveryPenalty: Math.round(deliveryPenalty * 10000) / 10000,
    evidenceWeight: Math.round(Math.max(validationEvidence, reviewEvidence, auditEvidence) * 10000) / 10000,
  };
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
  const historyBreakdown = scoreWorkerHistory(worker);

  const score = predictedSuccess * 0.55
    + confidence * 0.25
    + roleBonus
    + historyBreakdown.historyScoreAdjustment
    - normalizedCost * 0.25
    - riskPenalty
    - missingPricePenalty;

  return {
    score: Math.round(score * 10000) / 10000,
    predictedCostUsd,
    predictedSuccess,
    confidence,
    normalizedCost,
    riskPenalty,
    roleBonus,
    missingPricePenalty,
    ...historyBreakdown,
  };
}
