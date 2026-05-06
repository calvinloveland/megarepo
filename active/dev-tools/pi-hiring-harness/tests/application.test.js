import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, parseApplicationResponse } from "../lib/application.js";

test("extractJsonObject finds fenced JSON", () => {
  const text = 'Here you go\n```json\n{"candidate_id":"researcher","plan_summary":"Investigate parser state","confidence":0.7}\n```';
  assert.equal(
    extractJsonObject(text),
    '{"candidate_id":"researcher","plan_summary":"Investigate parser state","confidence":0.7}',
  );
});

test("parseApplicationResponse normalizes fields", () => {
  const parsed = parseApplicationResponse(
    '{"candidate_id":"implementer","role_name":"implementer","relevant_strengths":["small diffs"],"likely_weaknesses":["may need more context"],"predicted_input_tokens":1200,"predicted_output_tokens":400,"predicted_success":0.8,"confidence":0.75,"plan_summary":"Patch the parser and run tests","max_cost_usd":0.12,"risks":["test fixture mismatch"]}',
    { name: "implementer", role: "implementer" },
  );

  assert.equal(parsed.candidateId, "implementer");
  assert.equal(parsed.roleName, "implementer");
  assert.deepEqual(parsed.relevantStrengths, ["small diffs"]);
  assert.equal(parsed.predictedInputTokens, 1200);
  assert.equal(parsed.maxCostUsd, 0.12);
  assert.deepEqual(parsed.risks, ["test fixture mismatch"]);
});

test("parseApplicationResponse rejects missing plan summary", () => {
  assert.throws(
    () => parseApplicationResponse('{"candidate_id":"researcher"}', { name: "researcher" }),
    /planSummary/,
  );
});
