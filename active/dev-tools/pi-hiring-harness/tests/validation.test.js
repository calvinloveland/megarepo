import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runValidationSuite, validateRequiredFiles } from "../lib/validation.js";

test("validateRequiredFiles reports present and missing files", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-hiring-validation-test-"));
  await fs.writeFile(path.join(tempRoot, "present.txt"), "ok", "utf-8");

  const checks = await validateRequiredFiles(["present.txt", "missing.txt"], tempRoot, tempRoot);
  assert.equal(checks[0].exists, true);
  assert.equal(checks[1].exists, false);
});

test("runValidationSuite executes commands and summarizes failures", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-hiring-validation-suite-"));
  await fs.writeFile(path.join(tempRoot, "artifact.txt"), "artifact", "utf-8");

  const validation = await runValidationSuite({
    requiredFiles: ["artifact.txt", "missing.txt"],
    validationCommands: ["test -f artifact.txt", "python - <<'PY'\nprint('hello')\nPY"],
    cwd: tempRoot,
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.summary.requiredFilesChecked, 2);
  assert.equal(validation.summary.commandsRun, 2);
  assert.equal(validation.summary.missingFiles, 1);
  assert.equal(validation.summary.failedCommands, 0);
});
