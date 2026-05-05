import test from "node:test";
import assert from "node:assert/strict";

import { TDD_TOOL_NAMES, syncTddToolNames } from "../extensions/tdd-tool-state.mjs";

test("syncTddToolNames removes all TDD-only tools when mode is off", () => {
	const next = syncTddToolNames(["read", "test_register", "bash", "tdd_complete", "admit_failure"], false);
	assert.deepEqual(next, ["read", "bash"]);
});

test("syncTddToolNames adds all TDD tools when mode is on", () => {
	const next = syncTddToolNames(["read", "bash"], true);
	assert.deepEqual(next, ["read", "bash", "test_register", "tdd_complete", "admit_failure"]);
	assert.deepEqual(TDD_TOOL_NAMES, ["test_register", "tdd_complete", "admit_failure"]);
});

test("syncTddToolNames does not duplicate TDD tools when mode is already on", () => {
	const next = syncTddToolNames(["read", ...TDD_TOOL_NAMES, "bash"], true);
	assert.deepEqual(next, ["read", "bash", ...TDD_TOOL_NAMES]);
});
