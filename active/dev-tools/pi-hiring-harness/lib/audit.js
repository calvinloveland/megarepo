function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function relativeError(predicted, actual) {
  const p = toNumber(predicted);
  const a = toNumber(actual);
  if (p === undefined || a === undefined) return undefined;
  if (p === 0) return a === 0 ? 0 : 1;
  return Math.abs(a - p) / Math.abs(p);
}

function round(value) {
  const parsed = toNumber(value);
  if (parsed === undefined) return undefined;
  return Math.round(parsed * 10000) / 10000;
}

export function extractReviewVerdict(reviewOutput) {
  const text = String(reviewOutput || "");
  if (!text.trim()) return "unknown";
  if (/\bpass\b/i.test(text) || /\bmeets? the contract\b/i.test(text)) return "pass";
  if (/\bfail\b/i.test(text) || /\bdoes not meet\b/i.test(text) || /\bblocker/i.test(text)) return "fail";
  return "unknown";
}

export function buildEmployeeReviewAudit({ selectedApplication, execution, validation, review }) {
  const application = selectedApplication?.application ?? {};
  const scoreBreakdown = selectedApplication?.scoreBreakdown ?? {};

  const predicted = {
    inputTokens: toNumber(application.predictedInputTokens),
    outputTokens: toNumber(application.predictedOutputTokens),
    latencySeconds: toNumber(application.predictedLatencySeconds),
    success: toNumber(application.predictedSuccess),
    confidence: toNumber(application.confidence),
    costUsd: toNumber(scoreBreakdown.predictedCostUsd ?? application.maxCostUsd),
  };

  const actual = {
    inputTokens: toNumber(execution?.usage?.input),
    outputTokens: toNumber(execution?.usage?.output),
    latencySeconds: toNumber(execution?.durationSeconds),
    costUsd: toNumber(execution?.usage?.cost),
    validationOk: validation?.ok ?? null,
    reviewVerdict: extractReviewVerdict(review?.output),
  };

  const errors = {
    inputTokensRelative: round(relativeError(predicted.inputTokens, actual.inputTokens)),
    outputTokensRelative: round(relativeError(predicted.outputTokens, actual.outputTokens)),
    latencyRelative: round(relativeError(predicted.latencySeconds, actual.latencySeconds)),
    costRelative: round(relativeError(predicted.costUsd, actual.costUsd)),
  };

  const observedSuccess = actual.validationOk === true
    ? 1
    : actual.validationOk === false || actual.reviewVerdict === "fail"
      ? 0
      : undefined;
  const successCalibrationGap = observedSuccess === undefined || predicted.success === undefined
    ? undefined
    : round(Math.abs(observedSuccess - predicted.success));

  const summaryParts = [];
  if (predicted.inputTokens !== undefined && actual.inputTokens !== undefined) {
    summaryParts.push(`input tokens predicted ${predicted.inputTokens}, actual ${actual.inputTokens}`);
  }
  if (predicted.outputTokens !== undefined && actual.outputTokens !== undefined) {
    summaryParts.push(`output tokens predicted ${predicted.outputTokens}, actual ${actual.outputTokens}`);
  }
  if (predicted.costUsd !== undefined && actual.costUsd !== undefined) {
    summaryParts.push(`cost predicted ${predicted.costUsd}, actual ${actual.costUsd}`);
  }
  if (successCalibrationGap !== undefined) {
    summaryParts.push(`success calibration gap ${successCalibrationGap}`);
  }
  if (actual.validationOk !== null) {
    summaryParts.push(`validation ${actual.validationOk ? "passed" : "failed"}`);
  }
  if (actual.reviewVerdict !== "unknown") {
    summaryParts.push(`review verdict ${actual.reviewVerdict}`);
  }

  return {
    predicted,
    actual,
    errors,
    successCalibrationGap,
    summary: summaryParts.join("; ") || "No employee review audit data available.",
  };
}
