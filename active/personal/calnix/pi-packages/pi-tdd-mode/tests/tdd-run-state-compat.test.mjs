import test from "node:test";
import assert from "node:assert/strict";

import { getCompatibleTddStatusLabel, recordCompatibleGreenPhase } from "../extensions/tdd-run-state-compat.mjs";

test("getCompatibleTddStatusLabel falls back when helper export is missing", () => {
	const label = getCompatibleTddStatusLabel(undefined, {
		enabled: true,
		activeRun: { task: "fix timezone parsing", startedAt: 1234, phase: "green_completed", registeredFailingTest: null },
	});
	assert.equal(label, "🧪 TDD active (green)");
});

test("getCompatibleTddStatusLabel delegates when helper export exists", () => {
	const label = getCompatibleTddStatusLabel(() => "custom label", {
		enabled: true,
		activeRun: null,
	});
	assert.equal(label, "custom label");
});

test("recordCompatibleGreenPhase falls back when helper export is missing", () => {
	const next = recordCompatibleGreenPhase(undefined, {
		enabled: true,
		activeRun: { task: "fix timezone parsing", startedAt: 1234, phase: "red_registered", registeredFailingTest: null },
	});
	assert.equal(next.activeRun?.phase, "green_completed");
});

test("recordCompatibleGreenPhase delegates when helper export exists", () => {
	const next = recordCompatibleGreenPhase(
		(state) => ({ ...state, activeRun: { ...state.activeRun, phase: "custom_green" } }),
		{
			enabled: true,
			activeRun: { task: "fix timezone parsing", startedAt: 1234, phase: "red_registered", registeredFailingTest: null },
		},
	);
	assert.equal(next.activeRun?.phase, "custom_green");
});
