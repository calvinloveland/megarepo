export const AUTOPILOT_STATE_TYPE = "autopilot-state";
export const TDD_STATE_TYPE = "tdd-mode-state";

function latestEnabled(entries = [], customType, defaultValue) {
	let value = defaultValue;
	for (const entry of entries) {
		if (entry?.type === "custom" && entry.customType === customType) {
			value = Boolean(entry.data?.enabled);
		}
	}
	return value;
}

export function isTddModeEnabled(entries = []) {
	return latestEnabled(entries, TDD_STATE_TYPE, false);
}

export function getAutopilotEnabled(entries = []) {
	if (isTddModeEnabled(entries)) return false;
	return latestEnabled(entries, AUTOPILOT_STATE_TYPE, true);
}
