export const TDD_STATE_TYPE = "tdd-mode-state";

export function buildRuntimeStateFromEntries(entries = []) {
	let enabled = false;
	let activeRun = null;
	for (const entry of entries) {
		if (entry?.type === "custom" && entry.customType === TDD_STATE_TYPE) {
			enabled = Boolean(entry.data?.enabled);
			activeRun = entry.data?.activeRun ?? null;
		}
	}
	return { enabled, activeRun };
}

export function startRun(state, task, startedAt = Date.now()) {
	return {
		enabled: true,
		activeRun: {
			task,
			startedAt,
			phase: "waiting_for_tests",
			registeredFailingTest: null,
		},
	};
}

export function recordRedPhase(state, failingTest) {
	if (!state.activeRun) return state;
	return {
		...state,
		activeRun: {
			...state.activeRun,
			phase: "red_registered",
			registeredFailingTest: failingTest,
		},
	};
}

export function recordGreenPhase(state) {
	if (!state.activeRun) return state;
	return {
		...state,
		activeRun: {
			...state.activeRun,
			phase: "green_completed",
		},
	};
}

export function getTddStatusLabel(state) {
	if (!state?.enabled) return "🧪 TDD mode off";
	if (state.activeRun?.phase === "green_completed") return "🧪 TDD active (green)";
	if (state.activeRun?.phase === "red_registered") return "🧪 TDD active (red registered)";
	return "🧪 TDD active";
}

export function cancelRun(state) {
	return {
		...state,
		activeRun: null,
	};
}

export function shouldEnforceTdd(state) {
	return Boolean(state?.enabled);
}
