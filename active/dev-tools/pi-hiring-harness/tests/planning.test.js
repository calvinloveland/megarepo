import test from "node:test";
import assert from "node:assert/strict";
import { buildJobs } from "../lib/planning.js";

test("buildJobs uses objective as a single bounded job", () => {
  const jobs = buildJobs({ objective: "Investigate parser bug", totalBudgetUsd: 0.8 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "job-1");
  assert.equal(jobs[0].maxBudgetUsd, 0.8);
});

test("buildJobs splits remaining budget across unspecified jobs", () => {
  const jobs = buildJobs({
    totalBudgetUsd: 1.0,
    jobs: [
      { id: "a", objective: "Research", maxBudgetUsd: 0.2 },
      { id: "b", objective: "Implement" },
      { id: "c", objective: "Review" },
    ],
  });

  assert.equal(jobs[0].maxBudgetUsd, 0.2);
  assert.equal(jobs[1].maxBudgetUsd, 0.4);
  assert.equal(jobs[2].maxBudgetUsd, 0.4);
});
