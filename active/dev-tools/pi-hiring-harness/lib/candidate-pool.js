function scoreWorkerMetadata(worker, job) {
  let score = 0;
  if (job.preferredRole && worker.role === job.preferredRole) score += 3;
  else if (!job.preferredRole && worker.role) score += 1;
  if (worker.model) score += 0.5;
  if (typeof worker.inputPricePerMillion === "number" && typeof worker.outputPricePerMillion === "number") score += 0.5;
  if (typeof worker.maxBudgetUsd !== "number" || worker.maxBudgetUsd >= job.maxBudgetUsd) score += 0.25;
  if (worker.source === "user") score += 0.1;
  if (worker.source === "project") score += 0.2;
  if (worker.history?.executions > 0 && typeof worker.history.validationPassRate === "number") {
    score += (worker.history.validationPassRate - 0.5) * 0.8;
  }
  if (worker.history?.reviewedExecutions > 0 && typeof worker.history.reviewPassRate === "number") {
    score += (worker.history.reviewPassRate - 0.5) * 0.4;
  }
  if (worker.history?.validationsFailed > 0) {
    score -= Math.min(worker.history.validationsFailed * 0.1, 0.4);
  }
  return score;
}

export function selectCandidatePool(workers, job, maxCandidatesPerJob) {
  let candidates = [...workers];

  if (job.preferredRole) {
    const roleMatches = candidates.filter((worker) => worker.role === job.preferredRole);
    if (roleMatches.length > 0) {
      candidates = roleMatches;
    }
  }

  if (job.preferredRole !== "reviewer") {
    const nonReviewers = candidates.filter((worker) => worker.role !== "reviewer");
    if (nonReviewers.length > 0) {
      candidates = nonReviewers;
    }
  }

  return candidates
    .sort((left, right) => {
      const rankDifference = scoreWorkerMetadata(right, job) - scoreWorkerMetadata(left, job);
      if (rankDifference !== 0) return rankDifference;
      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(1, maxCandidatesPerJob));
}
