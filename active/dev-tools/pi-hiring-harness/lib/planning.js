function roundUsd(value) {
  return Math.round(value * 10000) / 10000;
}

export function buildJobs({ objective, jobs, totalBudgetUsd }) {
  const normalizedJobs = Array.isArray(jobs) && jobs.length > 0
    ? jobs.map((job, index) => ({
        id: job.id ?? `job-${index + 1}`,
        objective: job.objective,
        acceptanceCriteria: job.acceptanceCriteria,
        preferredRole: job.preferredRole,
        cwd: job.cwd,
        maxBudgetUsd: typeof job.maxBudgetUsd === "number" ? job.maxBudgetUsd : undefined,
      }))
    : objective
      ? [{ id: "job-1", objective, maxBudgetUsd: totalBudgetUsd }]
      : [];

  const explicitBudget = normalizedJobs.reduce((sum, job) => sum + (job.maxBudgetUsd ?? 0), 0);
  const unbudgetedJobs = normalizedJobs.filter((job) => job.maxBudgetUsd === undefined);
  const remainingBudget = Math.max(totalBudgetUsd - explicitBudget, 0);
  const sharedBudget = unbudgetedJobs.length > 0 ? remainingBudget / unbudgetedJobs.length : 0;

  for (const job of normalizedJobs) {
    if (job.maxBudgetUsd === undefined) {
      job.maxBudgetUsd = roundUsd(sharedBudget);
    } else {
      job.maxBudgetUsd = roundUsd(job.maxBudgetUsd);
    }
  }

  return normalizedJobs;
}
