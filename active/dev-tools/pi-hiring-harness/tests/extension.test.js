import test from "node:test";
import assert from "node:assert/strict";
import { selectCandidatePool } from "../lib/candidate-pool.js";

test("selectCandidatePool prefers exact preferredRole matches over reviewer workers", () => {
  const workers = [
    { name: "reviewer-gpt54", role: "reviewer", source: "project", model: "github-copilot/gpt-5.4" },
    { name: "implementer-local", role: "implementer", source: "project", model: "ollama/llama3.2:1b" },
  ];

  const selected = selectCandidatePool(workers, { preferredRole: "implementer", maxBudgetUsd: 1 }, 2);

  assert.deepEqual(selected.map((worker) => worker.name), ["implementer-local"]);
});

test("selectCandidatePool still returns reviewer workers for reviewer jobs", () => {
  const workers = [
    { name: "reviewer-gpt54", role: "reviewer", source: "project", model: "github-copilot/gpt-5.4" },
    { name: "implementer-local", role: "implementer", source: "project", model: "ollama/llama3.2:1b" },
  ];

  const selected = selectCandidatePool(workers, { preferredRole: "reviewer", maxBudgetUsd: 1 }, 2);

  assert.deepEqual(selected.map((worker) => worker.name), ["reviewer-gpt54"]);
});
