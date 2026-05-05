import test from "node:test";
import assert from "node:assert/strict";

import {
	TDD_STATE_TYPE,
	buildRuntimeStateFromEntries,
	cancelRun,
	getTddStatusLabel,
	recordGreenPhase,
	recordRedPhase,
	shouldEnforceTdd,
	startRun,
} from "../extensions/tdd-run-state.mjs";

function customEntry(customType, data) {
	return { type: "custom", customType, data };
}

test("tdd mode enabled enforces TDD even without an active run", () => {
	const state = buildRuntimeStateFromEntries([customEntry(TDD_STATE_TYPE, { enabled: true })]);
	assert.equal(state.enabled, true);
	assert.equal(state.activeRun, null);
	assert.equal(shouldEnforceTdd(state), true);
});

test("starting a run activates TDD enforcement and tracks the task", () => {
	const started = startRun(buildRuntimeStateFromEntries([]), "fix timezone parsing", 1234);
	assert.equal(started.enabled, true);
	assert.equal(started.activeRun?.task, "fix timezone parsing");
	assert.equal(started.activeRun?.phase, "waiting_for_tests");
	assert.equal(shouldEnforceTdd(started), true);
});

test("recordRedPhase advances the active run to red_registered", () => {
	const started = startRun(buildRuntimeStateFromEntries([]), "fix timezone parsing", 1234);
	const updated = recordRedPhase(started, {
		testCommand: "pytest tests/test_time.py -q",
		testFiles: ["tests/test_time.py"],
		exitCode: 1,
		stdout: "",
		stderr: "AssertionError",
	});
	assert.equal(updated.activeRun?.phase, "red_registered");
	assert.equal(updated.activeRun?.registeredFailingTest?.exitCode, 1);
	assert.deepEqual(updated.activeRun?.registeredFailingTest?.testFiles, ["tests/test_time.py"]);
});

test("recordGreenPhase advances the active run to green_completed", () => {
	const started = startRun(buildRuntimeStateFromEntries([]), "fix timezone parsing", 1234);
	const red = recordRedPhase(started, {
		testCommand: "pytest tests/test_time.py -q",
		testFiles: ["tests/test_time.py"],
		exitCode: 1,
		stdout: "",
		stderr: "AssertionError",
	});
	const green = recordGreenPhase(red);
	assert.equal(green.activeRun?.phase, "green_completed");
	assert.equal(green.activeRun?.registeredFailingTest?.exitCode, 1);
});


test("getTddStatusLabel reflects off, active, red, and green states", () => {
	assert.equal(getTddStatusLabel({ enabled: false, activeRun: null }), "🧪 TDD mode off");
	assert.equal(getTddStatusLabel({ enabled: true, activeRun: null }), "🧪 TDD active");
	assert.equal(
		getTddStatusLabel({
			enabled: true,
			activeRun: { task: "fix timezone parsing", startedAt: 1234, phase: "red_registered", registeredFailingTest: null },
		}),
		"🧪 TDD active (red registered)",
	);
	assert.equal(
		getTddStatusLabel({
			enabled: true,
			activeRun: { task: "fix timezone parsing", startedAt: 1234, phase: "green_completed", registeredFailingTest: null },
		}),
		"🧪 TDD active (green)",
	);
});


test("cancelRun clears the active run but preserves enabled mode", () => {
	const started = startRun(buildRuntimeStateFromEntries([customEntry(TDD_STATE_TYPE, { enabled: true })]), "fix timezone parsing", 1234);
	const cancelled = cancelRun(started);
	assert.equal(cancelled.enabled, true);
	assert.equal(cancelled.activeRun, null);
	assert.equal(shouldEnforceTdd(cancelled), true);
});
