import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverWorkers, parseWorkerMarkdown } from "../lib/workers.js";

async function writeWorker(dir, name, description, extra = "") {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\nrole: researcher\n${extra}---\n\nPrompt body`,
    "utf-8",
  );
}

test("parseWorkerMarkdown reads core metadata", () => {
  const worker = parseWorkerMarkdown(
    `---\nname: reviewer\ndescription: Finds defects\nrole: reviewer\ntools: read,bash\ninput_price_per_million: 1.5\noutput_price_per_million: 2.5\n---\n\nReview carefully`,
    "/tmp/reviewer.md",
    "builtin",
  );

  assert.equal(worker.name, "reviewer");
  assert.deepEqual(worker.tools, ["read", "bash"]);
  assert.equal(worker.inputPricePerMillion, 1.5);
  assert.equal(worker.source, "builtin");
});

test("discoverWorkers lets project workers override builtin and user workers", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-hiring-workers-test-"));
  const builtinDir = path.join(tempRoot, "builtin");
  const userDir = path.join(tempRoot, "user");
  const projectDir = path.join(tempRoot, "project");

  await writeWorker(builtinDir, "researcher", "builtin researcher");
  await writeWorker(userDir, "researcher", "user researcher");
  await writeWorker(projectDir, "researcher", "project researcher");
  await writeWorker(projectDir, "implementer", "project implementer");

  const discovery = discoverWorkers({
    cwd: tempRoot,
    scope: "both",
    builtinDir,
    userWorkersDir: userDir,
    projectWorkersDir: projectDir,
  });

  assert.equal(discovery.workers.length, 2);
  const researcher = discovery.workers.find((worker) => worker.name === "researcher");
  assert.equal(researcher.description, "project researcher");
  assert.equal(researcher.source, "project");
});
