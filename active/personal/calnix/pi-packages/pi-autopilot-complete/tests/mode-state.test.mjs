import test from "node:test";
import assert from "node:assert/strict";

import { AUTOPILOT_STATE_TYPE, TDD_STATE_TYPE, getAutopilotEnabled, isTddModeEnabled } from "../extensions/autopilot-mode-state.mjs";

function customEntry(customType, enabled) {
	return { type: "custom", customType, data: { enabled } };
}

test("autopilot defaults to enabled when no state is present", () => {
	assert.equal(getAutopilotEnabled([]), true);
	assert.equal(isTddModeEnabled([]), false);
});

test("explicit autopilot off state disables autopilot", () => {
	const entries = [customEntry(AUTOPILOT_STATE_TYPE, false)];
	assert.equal(getAutopilotEnabled(entries), false);
});

test("tdd mode suppresses autopilot even if autopilot state is on", () => {
	const entries = [customEntry(AUTOPILOT_STATE_TYPE, true), customEntry(TDD_STATE_TYPE, true)];
	assert.equal(isTddModeEnabled(entries), true);
	assert.equal(getAutopilotEnabled(entries), false);
});

test("autopilot can be enabled again when tdd mode is off", () => {
	const entries = [customEntry(AUTOPILOT_STATE_TYPE, true), customEntry(TDD_STATE_TYPE, false)];
	assert.equal(isTddModeEnabled(entries), false);
	assert.equal(getAutopilotEnabled(entries), true);
});
