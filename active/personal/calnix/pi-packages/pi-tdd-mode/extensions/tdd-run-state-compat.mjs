function fallbackStatusLabel(state) {
	if (!state?.enabled) return "🧪 TDD mode off";
	if (state.activeRun?.phase === "green_completed") return "🧪 TDD active (green)";
	if (state.activeRun?.phase === "red_registered") return "🧪 TDD active (red registered)";
	return "🧪 TDD active";
}

export function getCompatibleTddStatusLabel(getTddStatusLabel, state) {
	if (typeof getTddStatusLabel === "function") {
		return getTddStatusLabel(state);
	}
	return fallbackStatusLabel(state);
}

export function recordCompatibleGreenPhase(recordGreenPhase, state) {
	if (typeof recordGreenPhase === "function") {
		return recordGreenPhase(state);
	}
	if (!state?.activeRun) {
		return state;
	}
	return {
		...state,
		activeRun: {
			...state.activeRun,
			phase: "green_completed",
		},
	};
}
