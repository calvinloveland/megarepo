function toNumberOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function balancedJsonSubstring(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function extractJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // fall through
    }
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    const candidate = fencedMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // fall through
    }
  }

  const balanced = balancedJsonSubstring(trimmed);
  if (!balanced) return null;
  JSON.parse(balanced);
  return balanced;
}

export function parseApplicationResponse(text, worker) {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new Error("Worker application did not contain a valid JSON object.");
  }

  const parsed = JSON.parse(jsonText);

  const application = {
    candidateId: parsed.candidateId ?? parsed.candidate_id ?? worker?.name,
    roleName: parsed.roleName ?? parsed.role_name ?? worker?.role,
    relevantStrengths: normalizeStringArray(parsed.relevantStrengths ?? parsed.relevant_strengths),
    likelyWeaknesses: normalizeStringArray(parsed.likelyWeaknesses ?? parsed.likely_weaknesses),
    predictedInputTokens: toNumberOrUndefined(parsed.predictedInputTokens ?? parsed.predicted_input_tokens),
    predictedOutputTokens: toNumberOrUndefined(parsed.predictedOutputTokens ?? parsed.predicted_output_tokens),
    predictedLatencySeconds: toNumberOrUndefined(
      parsed.predictedLatencySeconds ?? parsed.predicted_latency_seconds,
    ),
    predictedSuccess: toNumberOrUndefined(parsed.predictedSuccess ?? parsed.predicted_success),
    confidence: toNumberOrUndefined(parsed.confidence),
    evidenceSource: parsed.evidenceSource ?? parsed.evidence_source,
    planSummary: String(parsed.planSummary ?? parsed.plan_summary ?? "").trim(),
    maxCostUsd: toNumberOrUndefined(parsed.maxCostUsd ?? parsed.max_cost_usd),
    preferredReviewLevel: parsed.preferredReviewLevel ?? parsed.preferred_review_level,
    risks: normalizeStringArray(parsed.risks),
  };

  if (!application.candidateId) {
    throw new Error("Worker application is missing candidateId.");
  }

  if (!application.planSummary) {
    throw new Error("Worker application is missing planSummary.");
  }

  return application;
}

export function buildApplicationPrompt({ job, worker, totalBudgetUsd }) {
  return [
    "You are applying for a bounded worker contract inside a budget-aware agent organization.",
    "Return ONLY a JSON object. Do not include markdown fences or prose before/after the JSON.",
    "Do not delegate. Do not hire sub-workers. Do not mention internal chain-of-thought.",
    "",
    `Worker name: ${worker.name}`,
    `Worker role: ${worker.role ?? "unspecified"}`,
    `Job id: ${job.id}`,
    `Job objective: ${job.objective}`,
    `Acceptance criteria: ${job.acceptanceCriteria ?? "not provided"}`,
    `Preferred role: ${job.preferredRole ?? "not provided"}`,
    `Job budget cap (USD): ${job.maxBudgetUsd.toFixed(4)}`,
    `Run budget (USD): ${Number(totalBudgetUsd).toFixed(4)}`,
    "",
    "Return this exact shape:",
    '{"candidate_id":"...","role_name":"...","relevant_strengths":["..."],"likely_weaknesses":["..."],"predicted_input_tokens":123,"predicted_output_tokens":123,"predicted_latency_seconds":12,"predicted_success":0.0,"confidence":0.0,"evidence_source":"self-assessment|historical memory|prompt fit","plan_summary":"...","max_cost_usd":0.0,"preferred_review_level":"none|light|normal|strict","risks":["..."]}',
    "",
    "Use probabilities between 0 and 1.",
    "Keep plan_summary under 80 words.",
  ].join("\n");
}

export function buildExecutionPrompt({ job, selectedApplication }) {
  return [
    "You have been hired for a bounded job inside a CEO-managed agent framework.",
    "Do not delegate. Do not hire sub-workers. Stay within scope.",
    "",
    `Job id: ${job.id}`,
    `Objective: ${job.objective}`,
    `Acceptance criteria: ${job.acceptanceCriteria ?? "not provided"}`,
    `Budget cap (USD): ${job.maxBudgetUsd.toFixed(4)}`,
    `Application plan: ${selectedApplication.planSummary}`,
    "",
    "Return these sections:",
    "Completed",
    "Deliverable",
    "Risks",
    "Next Steps",
  ].join("\n");
}

export function buildReviewPrompt({ job, selectedApplication, executionOutput }) {
  return [
    "You are reviewing a worker deliverable for a CEO-managed agent framework.",
    "Do not delegate. Assess whether the deliverable appears to satisfy the contract.",
    "",
    `Job id: ${job.id}`,
    `Objective: ${job.objective}`,
    `Acceptance criteria: ${job.acceptanceCriteria ?? "not provided"}`,
    `Selected worker plan: ${selectedApplication.planSummary}`,
    "",
    "Worker deliverable:",
    executionOutput || "(empty output)",
    "",
    "Return these sections:",
    "Verdict",
    "Blockers",
    "Risks",
    "Recommended Next Step",
  ].join("\n");
}
