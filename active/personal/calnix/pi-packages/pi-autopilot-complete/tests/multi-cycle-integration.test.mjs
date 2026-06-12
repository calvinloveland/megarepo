/**
 * Multi-cycle integration test for the super autopilot loop.
 *
 * Simulates the full turn cycle that happens in a real agent session:
 *   1. before_agent_start → agent works → complete({ futureWork: [...] })
 *   2. Tool returns "=== NEXT TASK ===" (no terminate)
 *   3. turn_start resets per-turn state
 *   4. Agent continues working → complete({ futureWork: [...] })
 *   5. ... repeat N times
 *   6. complete({ futureWork: [] }) → terminate, loop stops
 *
 * This tests that the extension correctly handles multiple same-turn
 * continuations without leaking state between cycles.
 */
import test from "node:test";
import assert from "node:assert/strict";

import factory from "../extensions/autopilot-complete.ts";

function createMockPi() {
	const sessionEntries = [];
	const sentMessages = [];
	const sentUserMessages = [];
	const statusBar = new Map();
	const notifications = [];
	const tools = new Map();
	const commands = new Map();

	const mockPi = {
		_handlers: new Map(),

		on(event, handler) {
			const list = this._handlers.get(event) ?? [];
			list.push(handler);
			this._handlers.set(event, list);
		},

		async _triggerEvent(eventName, eventData, ctx) {
			const handlers = this._handlers.get(eventName) ?? [];
			const results = [];
			for (const h of handlers) {
				const result = await h(eventData, ctx);
				if (result !== undefined) results.push(result);
			}
			return results;
		},

		registerTool(toolDef) {
			tools.set(toolDef.name, toolDef);
		},
		_getTool(name) {
			return tools.get(name);
		},

		registerCommand(name, opts) {
			commands.set(name, opts);
		},
		_getCommand(name) {
			return commands.get(name);
		},

		sendMessage(message, options) {
			sentMessages.push({ message, options });
		},
		_clearSentMessages() {
			sentMessages.length = 0;
		},
		get sentMessages() { return sentMessages; },

		appendEntry(customType, data) {
			sessionEntries.push({ type: "custom", customType, data });
		},

		sendUserMessage(content, options) {
			sentUserMessages.push({ content, options });
		},

		// Stubs
		setSessionName() {},
		getSessionName() {},
		setLabel() {},
		exec() {},
		getActiveTools() {},
		getAllTools() {},
		setActiveTools() {},
		getCommands() {},
		setModel() {},
		getThinkingLevel() {},
		setThinkingLevel() {},
		registerProvider() {},
		unregisterProvider() {},
		registerShortcut() {},
		registerFlag() {},
		getFlag() {},
		registerMessageRenderer() {},
		events: { emit() {}, on() {}, off() {} },
	};

	function createMockCtx(overrides = {}) {
		return {
			ui: {
				notify(message, type) { notifications.push({ message, type }); },
				setStatus(key, value) { statusBar.set(key, value); },
				select() {},
				confirm() {},
				input() {},
				onTerminalInput() {},
				setWorkingMessage() {},
				setWorkingVisible() {},
				setWorkingIndicator() {},
				setHiddenThinkingLabel() {},
				setWidget() {},
				setFooter() {},
				setHeader() {},
				setTitle() {},
				custom() {},
				pasteToEditor() {},
				setEditorText() {},
				getEditorText() { return ""; },
				editor() {},
				addAutocompleteProvider() {},
				setEditorComponent() {},
				getEditorComponent() {},
				theme: {},
				getAllThemes() { return []; },
				getTheme() {},
				setTheme() {},
				getToolsExpanded() { return true; },
				setToolsExpanded() {},
			},
			hasUI: true,
			cwd: "/home/test",
			sessionManager: {
				getEntries() { return sessionEntries; },
			},
			modelRegistry: {},
			model: undefined,
			isIdle() { return true; },
			signal: undefined,
			abort() {},
			hasPendingMessages() { return false; },
			shutdown() {},
			getContextUsage() {},
			compact() {},
			getSystemPrompt() { return "base system prompt"; },
			...overrides,
		};
	}

	return { mockPi, createMockCtx, sessionEntries, sentMessages, sentUserMessages, statusBar, notifications };
}

const { mockPi: pi, createMockCtx, sessionEntries } = createMockPi();
await factory(pi);

async function resetState() {
	sessionEntries.length = 0;
	await pi._triggerEvent("session_start", { reason: "new" }, createMockCtx());
}

test("super autopilot: multi-cycle same-turn integration", async () => {
	await resetState();

	const sc = pi._getCommand("superautopilot");
	const tool = pi._getTool("complete");

	// Enable super autopilot
	await sc.handler("on", createMockCtx());

	const cycles = [
		{ work: "Fix login bug", next: ["Add tests", "Deploy"] },
		{ work: "Add login tests", next: ["Deploy"] },
		{ work: "Deploy to staging", next: [] },
	];

	for (let i = 0; i < cycles.length; i++) {
		const cycle = cycles[i];

		// Simulate before_agent_start (real cycle start)
		await pi._triggerEvent(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: `work on ${cycle.work}`,
				systemPrompt: "",
				systemPromptOptions: {},
			},
			createMockCtx(),
		);

		// Agent calls complete
		const result = await tool.execute(
			`cycle_${i}`,
			{ futureWork: cycle.next, summary: `Completed ${cycle.work}` },
			undefined,
			undefined,
			createMockCtx({ hasUI: true }),
		);

		// Assert same-turn behavior
		if (cycle.next.length > 0) {
			// Non-empty: should NOT terminate, should include "NEXT TASK" in output
			assert.equal(result.terminate, undefined,
				`cycle ${i}: non-empty futureWork should not terminate`);
			assert.ok(result.content[0].text.includes("NEXT TASK"),
				`cycle ${i}: should include NEXT TASK block`);
			assert.ok(result.content[0].text.includes(cycle.next[0]),
				`cycle ${i}: should include next task in output`);
			assert.ok(result.content[0].text.includes(`Completed ${cycle.work}`),
				`cycle ${i}: should include summary`);

			// Simulate turn_start (in same turn, Pi continues after seeing the prompt)
			await pi._triggerEvent(
				"turn_start",
				{ type: "turn_start", turnIndex: i + 1, timestamp: Date.now() },
				createMockCtx(),
			);
		} else {
			// Empty: should terminate — no turn_start after termination
			assert.equal(result.terminate, true,
				`cycle ${i}: empty futureWork should terminate`);
			// Don't fire turn_start: in a real session, terminate stops the loop
		}
	}

	// Verify final state: super loop should have stopped
	// (last cycle had empty futureWork)
	const cmd = pi._getCommand("superautopilot");
	const lastNotification = [];
	const lastCtx = createMockCtx({
		hasUI: true,
		ui: {
			notify(msg, type) { lastNotification.push({ msg, type }); },
			setStatus() {},
			select() {},
			confirm() {},
			input() {},
			onTerminalInput() {},
			setWorkingMessage() {},
			setWorkingVisible() {},
			setWorkingIndicator() {},
			setHiddenThinkingLabel() {},
			setWidget() {},
			setFooter() {},
			setHeader() {},
			setTitle() {},
			custom() {},
			pasteToEditor() {},
			setEditorText() {},
			getEditorText() { return ""; },
			editor() {},
			addAutocompleteProvider() {},
			setEditorComponent() {},
			getEditorComponent() {},
			theme: {},
			getAllThemes() { return []; },
			getTheme() {},
			setTheme() {},
			getToolsExpanded() { return true; },
			setToolsExpanded() {},
		},
	});
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, lastCtx);
	const completedNotification = lastNotification.find(n => n.msg.includes("completed"));
	assert.ok(completedNotification, "should notify completion after empty futureWork");
});

test("super autopilot: status bar reflects iteration count after each cycle", async () => {
	await resetState();

	const sc = pi._getCommand("superautopilot");
	const tool = pi._getTool("complete");
	const statusBar = new Map();

	await sc.handler("on", createMockCtx());

	const mkCtx = (iter) => createMockCtx({
		hasUI: true,
		ui: {
			notify() {},
			setStatus(key, value) { statusBar.set(key, value); },
			select() {},
			confirm() {},
			input() {},
			onTerminalInput() {},
			setWorkingMessage() {},
			setWorkingVisible() {},
			setWorkingIndicator() {},
			setHiddenThinkingLabel() {},
			setWidget() {},
			setFooter() {},
			setHeader() {},
			setTitle() {},
			custom() {},
			pasteToEditor() {},
			setEditorText() {},
			getEditorText() { return ""; },
			editor() {},
			addAutocompleteProvider() {},
			setEditorComponent() {},
			getEditorComponent() {},
			theme: {},
			getAllThemes() { return []; },
			getTheme() {},
			setTheme() {},
			getToolsExpanded() { return true; },
			setToolsExpanded() {},
		},
	});

	// Cycle 1
	await tool.execute("c1", { futureWork: ["Task 2"] }, undefined, undefined, mkCtx(1));
	assert.ok(statusBar.get("autopilot")?.includes("1/50"), "iteration 1 should show 1/50");

	await pi._triggerEvent("turn_start", { type: "turn_start", turnIndex: 1, timestamp: Date.now() }, mkCtx(1));
	statusBar.clear();

	// Cycle 2
	await tool.execute("c2", { futureWork: ["Task 3"] }, undefined, undefined, mkCtx(2));
	assert.ok(statusBar.get("autopilot")?.includes("2/50"), "iteration 2 should show 2/50");

	await pi._triggerEvent("turn_start", { type: "turn_start", turnIndex: 2, timestamp: Date.now() }, mkCtx(2));
	statusBar.clear();

	// Cycle 3 — empty futureWork stops the loop
	await tool.execute("c3", { futureWork: [] }, undefined, undefined, mkCtx(3));
	// agent_end should reset iterations to 0
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, mkCtx(3));
	const afterStatus = statusBar.get("autopilot");
	assert.ok(afterStatus?.includes("0/50"),
		`after empty futureWork, iterations should be reset to 0/50, got: ${afterStatus}`);
});
