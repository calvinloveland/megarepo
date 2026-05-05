import test from "node:test";
import assert from "node:assert/strict";

import { buildChildPiArgs, SUBAGENT_IMAGE_SAFETY_PROMPT } from "../extensions/subagent-runner-config.mjs";

test("buildChildPiArgs disables unrelated discovery for isolated subagents", () => {
  const args = buildChildPiArgs({
    model: "openai/gpt-5",
    tools: ["read", "grep"],
    appendSystemPromptPath: "/tmp/subagent-prompt.md",
  });

  assert.deepEqual(args, [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--model",
    "openai/gpt-5",
    "--tools",
    "read,grep",
    "--append-system-prompt",
    "/tmp/subagent-prompt.md",
  ]);
});

test("image safety prompt warns subagents away from multi-image reads", () => {
  assert.match(SUBAGENT_IMAGE_SAFETY_PROMPT, /Prefer text artifacts/);
  assert.match(SUBAGENT_IMAGE_SAFETY_PROMPT, /413 request errors/);
  assert.match(SUBAGENT_IMAGE_SAFETY_PROMPT, /Never read more than one image in the same turn/);
});
