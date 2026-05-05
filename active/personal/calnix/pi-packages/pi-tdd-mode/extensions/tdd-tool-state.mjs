export const TDD_TOOL_NAMES = Object.freeze(["test_register", "tdd_complete", "admit_failure"]);

export function syncTddToolNames(activeToolNames = [], enabled = false) {
	const withoutTddTools = activeToolNames.filter((name) => !TDD_TOOL_NAMES.includes(name));
	if (!enabled) {
		return withoutTddTools;
	}

	const next = [...withoutTddTools];
	for (const toolName of TDD_TOOL_NAMES) {
		if (!next.includes(toolName)) {
			next.push(toolName);
		}
	}
	return next;
}
