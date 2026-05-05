import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectTestFiles, resolvePaths, truncateOutput } from "../extensions/tdd-mode-utils.mjs";

test("resolvePaths normalizes relative and absolute test file paths", () => {
	const cwd = "/tmp/demo";
	assert.deepEqual(resolvePaths(["tests/test_app.py", "/abs/test_other.py", "tests/test_app.py"], cwd), [
		"/tmp/demo/tests/test_app.py",
		"/abs/test_other.py",
	]);
});

test("truncateOutput keeps short output unchanged and trims long output", () => {
	assert.equal(truncateOutput("ok"), "ok");
	const long = "a".repeat(5000);
	const truncated = truncateOutput(long, 100);
	assert.ok(truncated.length < long.length);
	assert.match(truncated, /…/);
});

test("inspectTestFiles detects changed and missing test files", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-tdd-mode-"));
	const existing = join(dir, "tests", "test_app.py");
	await mkdir(join(dir, "tests"), { recursive: true });
	await writeFile(existing, "def test_ok():\n    assert True\n", { flag: "w" });
	const turnStartedAt = Date.now() - 2000;

	const result = await inspectTestFiles([existing, join(dir, "tests", "missing_test.py")], dir, turnStartedAt);
	assert.deepEqual(result.missing, [join(dir, "tests", "missing_test.py")]);
	assert.deepEqual(result.changedThisRun, [existing]);
	assert.equal(result.ok, false);
});
