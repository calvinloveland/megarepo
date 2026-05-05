import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverAgents, formatAgentList } from "../extensions/agents.ts";

async function writeAgent(dir, name, description, sourceText = "You are helpful.") {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${sourceText}\n`,
    "utf-8",
  );
}

test("discoverAgents includes bundled agents by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-"));
  const bundledDir = join(root, "bundled");
  await writeAgent(bundledDir, "scout", "Bundled scout");

  const result = discoverAgents(root, "user", {
    bundledAgentsDir: bundledDir,
    userAgentsDir: join(root, "missing-user"),
    projectAgentsDir: null,
  });

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].name, "scout");
  assert.equal(result.agents[0].source, "bundled");
});

test("discoverAgents lets user agents override bundled agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-"));
  const bundledDir = join(root, "bundled");
  const userDir = join(root, "user");
  await writeAgent(bundledDir, "worker", "Bundled worker");
  await writeAgent(userDir, "worker", "User worker");

  const result = discoverAgents(root, "user", {
    bundledAgentsDir: bundledDir,
    userAgentsDir: userDir,
    projectAgentsDir: null,
  });

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].description, "User worker");
  assert.equal(result.agents[0].source, "user");
});

test("discoverAgents gives project agents highest priority in both scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-"));
  const bundledDir = join(root, "bundled");
  const userDir = join(root, "user");
  const projectDir = join(root, "project");
  await writeAgent(bundledDir, "planner", "Bundled planner");
  await writeAgent(userDir, "planner", "User planner");
  await writeAgent(projectDir, "planner", "Project planner");

  const result = discoverAgents(root, "both", {
    bundledAgentsDir: bundledDir,
    userAgentsDir: userDir,
    projectAgentsDir: projectDir,
  });

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].description, "Project planner");
  assert.equal(result.agents[0].source, "project");
  assert.equal(result.projectAgentsDir, projectDir);
});

test("formatAgentList includes source labels and overflow count", () => {
  const summary = formatAgentList(
    [
      { name: "scout", description: "Fast recon", systemPrompt: "", source: "bundled", filePath: "/tmp/scout.md" },
      { name: "worker", description: "General implementation", systemPrompt: "", source: "user", filePath: "/tmp/worker.md" },
    ],
    1,
  );

  assert.match(summary.text, /scout \(bundled\): Fast recon/);
  assert.equal(summary.remaining, 1);
});
