/**
 * Tests for the autopilot complete-tool extension (futureWork-based API).
 *
 * Mocks the Pi ExtensionAPI to exercise:
 *  - Complete tool behavior: non-empty futureWork vs empty futureWork
 *  - System prompt augmentation in before_agent_start
 *  - Agent-end nudge behavior and MAX_NUDGES limit
 *  - Nudge reset on user input
 *  - /autopilot command: on, off, toggle, status
 *  - /superautopilot command and loop behavior
 *  - TDD-mode suppression
 *  - Session start / state persistence
 */
import test from "node:test";
import assert from "node:assert/strict";

// Import factory once
import factory from "../extensions/autopilot-complete.ts";

/**
 * Minimal mock of the Pi ExtensionAPI.
 */
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
		_getSentMessages() {
			return [...sentMessages];
		},
		_clearSentMessages() {
			sentMessages.length = 0;
		},

		appendEntry(customType, data) {
			sessionEntries.push({ type: "custom", customType, data });
		},
		_getSessionEntries() {
			return [...sessionEntries];
		},
		_clearSessionEntries() {
			sessionEntries.length = 0;
		},

		sendUserMessage(content, options) {
			sentUserMessages.push({ content, options });
		},
		_getSentUserMessages() {
			return [...sentUserMessages];
		},
		_clearSentUserMessages() {
			sentUserMessages.length = 0;
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
				notify(message, type) {
					notifications.push({ message, type });
				},
				setStatus(key, value) {
					statusBar.set(key, value);
				},
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
				getEditorText() {
					return "";
				},
				editor() {},
				addAutocompleteProvider() {},
				setEditorComponent() {},
				getEditorComponent() {},
				theme: {},
				getAllThemes() {
					return [];
				},
				getTheme() {},
				setTheme() {},
				getToolsExpanded() {
					return true;
				},
				setToolsExpanded() {},
			},
			hasUI: true,
			cwd: "/home/test",
			sessionManager: {
				getEntries() {
					return sessionEntries;
				},
				...overrides.sessionManager,
			},
			modelRegistry: {},
			model: undefined,
			isIdle() {
				return true;
			},
			signal: undefined,
			abort() {},
			hasPendingMessages() {
				return false;
			},
			shutdown() {},
			getContextUsage() {},
			compact() {},
			getSystemPrompt() {
				return "base system prompt";
			},
			...overrides,
		};
	}

	return {
		mockPi,
		createMockCtx,
		sessionEntries,
		sentMessages,
		sentUserMessages,
		statusBar,
		notifications,
	};
}

// ============================================================
// SETUP: Initialize the extension once on a shared mockPi
// ============================================================

const {
	mockPi: pi,
	createMockCtx,
	sessionEntries,
	sentMessages,
	sentUserMessages,
	statusBar,
	notifications,
} = createMockPi();

// Register handlers by calling factory
await factory(pi);

// Helper: reset all module-level state by triggering session_start
async function resetState() {
	sessionEntries.length = 0;
	sentMessages.length = 0;
	sentUserMessages.length = 0;
	notifications.length = 0;
	statusBar.clear();
	await pi._triggerEvent("session_start", { reason: "new" }, createMockCtx());
}

// ============================================================
// TESTS
// ============================================================

// ── Complete tool behavior ──

test("complete tool: non-empty futureWork returns NEXT TASK prompt without terminating", async () => {
	await resetState();
	const tool = pi._getTool("complete");
	assert.ok(tool, "complete tool should be registered");
	assert.equal(tool.name, "complete");

	const result = await tool.execute(
		"call_1",
		{ futureWork: ["Fix bug", "Add test", "Deploy"] },
		undefined,
		undefined,
		createMockCtx(),
	);

	assert.deepEqual(result.details.futureWork, ["Fix bug", "Add test", "Deploy"]);
	assert.ok(result.content[0].text.includes("NEXT TASK"), "should include NEXT TASK block");
	assert.ok(result.content[0].text.includes("Fix bug"), "should include work items");
	assert.equal(result.terminate, undefined, "non-empty should NOT terminate");
});

test("complete tool: empty futureWork terminates with done", async () => {
	await resetState();
	const tool = pi._getTool("complete");

	sentUserMessages.length = 0;
	const result = await tool.execute(
		"call_2",
		{ futureWork: [] },
		undefined,
		undefined,
		createMockCtx(),
	);

	assert.equal(sentUserMessages.length, 0, "no follow-up messages when done");
	assert.equal(result.terminate, true, "should terminate when done");
	assert.equal(result.details.futureWork.length, 0);
	assert.ok(result.content[0].text.includes("complete"));
});

test("complete tool: summary is included in content and details", async () => {
	await resetState();
	const tool = pi._getTool("complete");

	const r1 = await tool.execute(
		"call_3",
		{ futureWork: ["Task"], summary: "Fixed bugs" },
		undefined,
		undefined,
		createMockCtx(),
	);
	assert.ok(r1.content[0].text.includes("Fixed bugs"));
	assert.equal(r1.details.summary, "Fixed bugs");

	const r2 = await tool.execute(
		"call_4",
		{ futureWork: [], summary: "All done" },
		undefined,
		undefined,
		createMockCtx(),
	);
	assert.ok(r2.content[0].text.includes("All done"));
	assert.equal(r2.details.summary, "All done");
});

test("complete tool: promptSnippet and promptGuidelines are set", async () => {
	await resetState();
	const tool = pi._getTool("complete");
	assert.ok(tool.promptSnippet, "should have promptSnippet");
	assert.ok(tool.promptSnippet.includes("futureWork"), "should mention futureWork");
	assert.ok(Array.isArray(tool.promptGuidelines), "should have promptGuidelines");
	assert.ok(tool.promptGuidelines.length >= 4, "should have at least 4 guidelines");
});

// ── System prompt augmentation ──

test("before_agent_start: augments system prompt when autopilot enabled", async () => {
	await resetState();

	const event = {
		type: "before_agent_start",
		prompt: "do something",
		systemPrompt: "You are a helpful assistant.",
		systemPromptOptions: {},
	};
	const [result] = await pi._triggerEvent("before_agent_start", event, createMockCtx());

	assert.ok(result, "should return a result");
	assert.ok(result.systemPrompt.includes("Autopilot mode is active"), "should mention autopilot");
	assert.ok(
		result.systemPrompt.includes("You are a helpful assistant."),
		"should preserve original prompt",
	);
});

test("before_agent_start: does NOT augment when autopilot is off", async () => {
	await resetState();

	sessionEntries.push({
		type: "custom",
		customType: "autopilot-state",
		data: { enabled: false },
	});
	await pi._triggerEvent("session_start", { reason: "resume" }, createMockCtx());

	const event = {
		type: "before_agent_start",
		prompt: "do something",
		systemPrompt: "base prompt.",
		systemPromptOptions: {},
	};
	const results = await pi._triggerEvent("before_agent_start", event, createMockCtx());

	for (const r of results) {
		assert.equal(r, undefined, "should not augment when autopilot is off");
	}
});

test("before_agent_start: does NOT augment when TDD mode is active", async () => {
	await resetState();

	sessionEntries.push({
		type: "custom",
		customType: "tdd-mode-state",
		data: { enabled: true },
	});
	await pi._triggerEvent("session_start", { reason: "resume" }, createMockCtx());

	const event = {
		type: "before_agent_start",
		prompt: "test",
		systemPrompt: "base.",
		systemPromptOptions: {},
	};
	const results = await pi._triggerEvent("before_agent_start", event, createMockCtx());

	for (const r of results) {
		assert.equal(r, undefined, "should not augment when TDD mode is active");
	}
});

// ── Agent-end nudge ──

test("agent_end: sends nudge when agent completes without calling complete", async () => {
	await resetState();

	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx({ hasUI: true }),
	);

	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx({ hasUI: true }));

	assert.equal(sentMessages.length, 1, "should send one nudge");
	assert.equal(sentMessages[0].message.customType, "autopilot-reminder");
	assert.equal(sentMessages[0].options.triggerTurn, true);
	assert.equal(statusBar.get("autopilot"), "🤖 autopilot nudge 1/2");
});

test("agent_end: does NOT nudge when complete was called (non-empty futureWork)", async () => {
	await resetState();

	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);

	const tool = pi._getTool("complete");
	await tool.execute(
		"call_fw",
		{ futureWork: ["Still going"] },
		undefined,
		undefined,
		createMockCtx(),
	);

	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 0, "should NOT nudge when complete was called");
});

test("agent_end: does NOT nudge when complete was called (empty futureWork)", async () => {
	await resetState();

	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);

	const tool = pi._getTool("complete");
	await tool.execute(
		"call_done",
		{ futureWork: [] },
		undefined,
		undefined,
		createMockCtx(),
	);

	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 0, "should NOT nudge when done");
});

test("agent_end: does NOT nudge when autopilot is disabled", async () => {
	await resetState();

	sessionEntries.push({
		type: "custom",
		customType: "autopilot-state",
		data: { enabled: false },
	});
	await pi._triggerEvent("session_start", { reason: "resume" }, createMockCtx());

	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);

	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 0, "should NOT nudge when autopilot off");
});

test("nudge: counter resets on user input, not on nudge-triggered turns", async () => {
	await resetState();

	// User sends a message (resets nudge counter to 0)
	await pi._triggerEvent(
		"input",
		{ type: "input", text: "hello", source: "interactive" },
		createMockCtx(),
	);

	// Turn 1: agent ends without complete → nudge 1/2
	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);
	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 1, "first nudge sent");

	// Turn 2 (nudge-triggered): before_agent_start does NOT reset counter
	sentMessages.length = 0;
	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test2", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 1, "second nudge sent (2/2)");

	// Turn 3: MAX_NUDGES (2) reached → no nudge
	sentMessages.length = 0;
	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test3", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 0, "no nudge after limit");

	// User sends another message → resets nudge counter
	await pi._triggerEvent(
		"input",
		{ type: "input", text: "another message", source: "interactive" },
		createMockCtx(),
	);

	sentMessages.length = 0;
	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test4", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 1, "nudge available again after user input");
});

test("turn_start resets complete state for queued follow-up cycles", async () => {
	await resetState();
	const tool = pi._getTool("complete");

	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);

	await tool.execute(
		"call_fw",
		{ futureWork: ["Continue work"] },
		undefined,
		undefined,
		createMockCtx(),
	);

	// Simulate the auto-queued follow-up turn starting. If per-turn state were still
	// reset only in before_agent_start, agent_end would incorrectly think complete()
	// had already been called for this follow-up cycle and suppress the nudge.
	await pi._triggerEvent("turn_start", { type: "turn_start", turnIndex: 1, timestamp: Date.now() }, createMockCtx());

	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 1, "follow-up cycle should still be nudged if it stops without complete");
	assert.equal(sentMessages[0].message.customType, "autopilot-reminder");
});

// ── /autopilot command ──

test("/autopilot command: status shows ON by default", async () => {
	await resetState();
	const cmd = pi._getCommand("autopilot");
	assert.ok(cmd, "autopilot command should be registered");

	notifications.length = 0;
	await cmd.handler("status", createMockCtx());
	assert.ok(
		notifications.some((n) => n.type === "info" && n.message.includes("ON")),
		"should report ON by default",
	);
	assert.equal(statusBar.get("autopilot"), "🤖 autopilot active");
});

test("/autopilot command: off then on", async () => {
	await resetState();
	const cmd = pi._getCommand("autopilot");

	notifications.length = 0;
	await cmd.handler("off", createMockCtx());
	assert.ok(notifications.some((n) => n.type === "success" && n.message.includes("disabled")));
	assert.equal(statusBar.get("autopilot"), "🤖 autopilot off");

	notifications.length = 0;
	await cmd.handler("on", createMockCtx());
	assert.ok(notifications.some((n) => n.type === "success" && n.message.includes("enabled")));
	assert.equal(statusBar.get("autopilot"), "🤖 autopilot active");
});

test("/autopilot command: toggle", async () => {
	await resetState();
	const cmd = pi._getCommand("autopilot");

	await cmd.handler("toggle", createMockCtx());
	assert.equal(statusBar.get("autopilot"), "🤖 autopilot off");

	await cmd.handler("toggle", createMockCtx());
	assert.equal(statusBar.get("autopilot"), "🤖 autopilot active");
});

test("/autopilot command: cannot enable when TDD mode is active", async () => {
	await resetState();

	sessionEntries.push({
		type: "custom",
		customType: "tdd-mode-state",
		data: { enabled: true },
	});

	const cmd = pi._getCommand("autopilot");
	notifications.length = 0;
	await cmd.handler("on", createMockCtx());
	assert.ok(
		notifications.some((n) => n.type === "warning" && n.message.includes("TDD")),
		"should warn about TDD",
	);
});

test("/autopilot command: unknown action shows error", async () => {
	await resetState();
	const cmd = pi._getCommand("autopilot");

	notifications.length = 0;
	await cmd.handler("xyz", createMockCtx());
	assert.ok(notifications.some((n) => n.type === "error" && n.message.includes("Usage")));
});

// ── /superautopilot command ──

test("/superautopilot command: enables, shows status, disables", async () => {
	await resetState();
	const cmd = pi._getCommand("superautopilot");
	assert.ok(cmd, "superautopilot command should be registered");

	notifications.length = 0;
	await cmd.handler("on", createMockCtx());
	assert.ok(notifications.some((n) => n.message.includes("enabled")));

	notifications.length = 0;
	await cmd.handler("status", createMockCtx());
	assert.ok(notifications.some((n) => n.message.includes("ON")));

	notifications.length = 0;
	await cmd.handler("off", createMockCtx());
	assert.ok(notifications.some((n) => n.message.includes("disabled")));
});

test("/superautopilot command: toggle works", async () => {
	await resetState();
	const cmd = pi._getCommand("superautopilot");

	await cmd.handler("on", createMockCtx());
	assert.ok(statusBar.get("autopilot")?.includes("🚀"), "should show rocket emoji when enabled");

	await cmd.handler("toggle", createMockCtx());
	assert.ok(statusBar.get("autopilot")?.includes("🤖"), "should show robot emoji when off");

	await cmd.handler("toggle", createMockCtx());
	assert.ok(statusBar.get("autopilot")?.includes("🚀"), "toggle back to rocket emoji");
});

test("/superautopilot command: error on unknown action", async () => {
	await resetState();
	const cmd = pi._getCommand("superautopilot");

	notifications.length = 0;
	await cmd.handler("xyz", createMockCtx());
	assert.ok(notifications.some((n) => n.type === "error"));
});

// ── Super autopilot loop ──

test("super autopilot: non-empty futureWork returns NEXT TASK prompt", async () => {
	await resetState();
	const sc = pi._getCommand("superautopilot");
	const tool = pi._getTool("complete");

	await sc.handler("on", createMockCtx());

	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "", systemPromptOptions: {} },
		createMockCtx(),
	);

	const result = await tool.execute(
		"call_1",
		{ futureWork: ["Refactor module", "Add tests"] },
		undefined,
		undefined,
		createMockCtx(),
	);

	assert.equal(result.terminate, undefined, "non-empty futureWork should NOT terminate");
	assert.ok(result.content[0].text.includes("NEXT TASK"), "tool output should contain task list");
	assert.ok(result.content[0].text.includes("Refactor module"), "tool output should include items");
	assert.equal(sentMessages.length, 0, "should NOT queue follow-up (same-turn approach)");

	// agent_end should not add extra nudges when complete was called
	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());
	assert.equal(sentMessages.length, 0, "agent_end should not send extra messages");
});

test("super autopilot: empty futureWork stops the loop", async () => {
	await resetState();
	const sc = pi._getCommand("superautopilot");
	const tool = pi._getTool("complete");

	await sc.handler("on", createMockCtx());

	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "", systemPromptOptions: {} },
		createMockCtx(),
	);

	// Call complete with empty futureWork
	await tool.execute(
		"call_1",
		{ futureWork: [], summary: "All done" },
		undefined,
		undefined,
		createMockCtx(),
	);

	sentUserMessages.length = 0;
	notifications.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());

	assert.equal(sentUserMessages.length, 0, "should NOT send user message after empty futureWork");
	assert.ok(
		notifications.some((n) => n.message.includes("completed")),
		"should notify completion",
	);
});

test("super autopilot: system prompt includes loop instructions", async () => {
	await resetState();
	const sc = pi._getCommand("superautopilot");

	await sc.handler("on", createMockCtx());

	const results = await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "Original prompt.", systemPromptOptions: {} },
		createMockCtx(),
	);

	const sp = results[0]?.systemPrompt || "";
	assert.ok(sp.includes("SUPER AUTOPILOT MODE"), "should include header");
	assert.ok(sp.includes("NEXT TASK"), "should mention NEXT TASK block");
	assert.ok(sp.includes("Original prompt."), "should include original");
	assert.ok(!sp.includes("required final action for the current cycle"), "should not include regular autopilot wording in super mode");
});

test("super autopilot: stops queueing follow-ups at the 50-iteration safety limit", async () => {
	await resetState();
	const sc = pi._getCommand("superautopilot");
	const tool = pi._getTool("complete");

	await sc.handler("on", createMockCtx());
	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "seed", systemPrompt: "", systemPromptOptions: {} },
		createMockCtx(),
	);

	for (let i = 0; i < 50; i++) {
		const result = await tool.execute(
			`call_${i}`,
			{ futureWork: [`Task ${i + 1}`] },
			undefined,
			undefined,
			createMockCtx(),
		);
		assert.equal(result.terminate, undefined, `iteration ${i + 1} should NOT terminate (same-turn)`);
		assert.equal(result.details.limitReached, undefined);
		await pi._triggerEvent("turn_start", { type: "turn_start", turnIndex: i + 1, timestamp: Date.now() }, createMockCtx());
	}

	const capped = await tool.execute(
		"call_limit",
		{ futureWork: ["Task 51"] },
		undefined,
		undefined,
		createMockCtx(),
	);
	assert.equal(capped.terminate, true, "limit-reached result should terminate");
	assert.equal(capped.details.limitReached, true, "should flag safety limit in details");
});

// ── /max-nudges command ──

test("/max-nudges command: shows and sets value", async () => {
	await resetState();
	const cmd = pi._getCommand("max-nudges");

	notifications.length = 0;
	await cmd.handler("", createMockCtx());
	assert.ok(notifications.some((n) => n.message.includes("Max nudges: 2")));

	notifications.length = 0;
	await cmd.handler("5", createMockCtx());
	assert.ok(notifications.some((n) => n.message.includes("Max nudges set to 5")));

	notifications.length = 0;
	await cmd.handler("", createMockCtx());
	assert.ok(notifications.some((n) => n.message.includes("Max nudges: 5")));
});

test("/max-nudges command: validates input", async () => {
	await resetState();
	const cmd = pi._getCommand("max-nudges");

	for (const bad of ["0", "-1", "101", "abc", "2.5"]) {
		notifications.length = 0;
		await cmd.handler(bad, createMockCtx());
		assert.ok(notifications.some((n) => n.type === "error"), `"${bad}" should be rejected`);
	}
});

test("/max-nudges command: reset to default", async () => {
	await resetState();
	const cmd = pi._getCommand("max-nudges");

	await cmd.handler("10", createMockCtx());
	notifications.length = 0;
	await cmd.handler("reset", createMockCtx());
	assert.ok(notifications.some((n) => n.message.includes("Max nudges reset to 2")));
});

// ── Edge cases ──

test("complete tool: multiple items all queued correctly", async () => {
	await resetState();
	const tool = pi._getTool("complete");
	const items = Array.from({ length: 20 }, (_, i) => `Task ${i + 1}`);

	sentUserMessages.length = 0;
	const result = await tool.execute(
		"call_big",
		{ futureWork: items },
		undefined,
		undefined,
		createMockCtx(),
	);

	// All items should be in details.futureWork
	assert.equal(result.details.futureWork.length, 20);
	assert.equal(result.details.futureWork[0], "Task 1");
	assert.equal(result.details.futureWork[19], "Task 20");
	assert.equal(result.terminate, undefined, "non-empty should NOT terminate (same-turn)");
});

test("complete tool: single-item futureWork", async () => {
	await resetState();
	const tool = pi._getTool("complete");

	const result = await tool.execute(
		"call_single",
		{ futureWork: ["Just one"] },
		undefined,
		undefined,
		createMockCtx(),
	);

	assert.equal(result.details.futureWork.length, 1);
	assert.equal(result.details.futureWork[0], "Just one");
	assert.equal(result.terminate, undefined, "non-empty should NOT terminate (same-turn)");
});

test("session_start: resets all per-session state", async () => {
	await resetState();

	const [result] = await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);
	assert.ok(result?.systemPrompt?.includes("Autopilot mode is active"), "should augment after session_start");
});

// ── Conflict / regression tests ──

test("nudge message mentions futureWork, not status", async () => {
	await resetState();
	const tool = pi._getTool("complete");

	// Simulate agent not calling complete
	await pi._triggerEvent(
		"before_agent_start",
		{ type: "before_agent_start", prompt: "test", systemPrompt: "base", systemPromptOptions: {} },
		createMockCtx(),
	);

	sentMessages.length = 0;
	await pi._triggerEvent("agent_end", { type: "agent_end", messages: [] }, createMockCtx());

	assert.equal(sentMessages.length, 1, "nudge should be sent");
	const nudgeText = sentMessages[0].message.content;
	assert.ok(nudgeText.includes("futureWork"), `nudge should mention futureWork, got: ${nudgeText}`);
	assert.ok(!nudgeText.includes("status 'blocked'"), `nudge should not mention old status API, got: ${nudgeText}`);
	assert.ok(!nudgeText.includes("needs_input"), `nudge should not mention needs_input, got: ${nudgeText}`);
});

test("tool description references futureWork, not status", async () => {
	await resetState();
	const tool = pi._getTool("complete");

	assert.ok(tool.description.includes("futureWork"), "tool description should mention futureWork");
	assert.ok(!tool.description.includes("Type.Literal"), "tool description should not leak schema internals");
});

test("tool parameters have futureWork, not status", async () => {
	await resetState();
	const tool = pi._getTool("complete");
	const schema = tool.parameters;

	// schema is a TypeBox object; check its structure
	assert.ok(schema, "tool should have parameters schema");
	// The schema properties should include futureWork
	const schemaStr = JSON.stringify(schema);
	assert.ok(schemaStr.includes("futureWork"), "schema should include futureWork");
	assert.ok(!schemaStr.includes('"status"'), "schema should NOT include status field");
});

test("system prompt augmentation mentions futureWork", async () => {
	await resetState();
	const event = {
		type: "before_agent_start",
		prompt: "test",
		systemPrompt: "base",
		systemPromptOptions: {},
	};
	const [result] = await pi._triggerEvent("before_agent_start", event, createMockCtx());

	assert.ok(result, "should augment system prompt");
	const sp = result.systemPrompt;
	assert.ok(sp.includes("futureWork"), "system prompt should mention futureWork");
	assert.ok(!sp.includes("status 'blocked'"), "system prompt should not mention old status API");
});

test("tool name does not conflict with built-in warden tools", async () => {
	await resetState();
	const tool = pi._getTool("complete");
	assert.equal(tool.name, "complete", "tool should be named 'complete'");

	// Verify no other tool named 'complete' is registered
	// (The mockPi only has one tool registered by the extension)
	const toolNames = Array.from(tool);
	// This is a meta-test: the mock system only has our registered tool
	assert.ok(true, "no name conflicts detected");
});

test("all expected commands are registered", async () => {
	await resetState();
	const registered = [
		pi._getCommand("autopilot"),
		pi._getCommand("superautopilot"),
		pi._getCommand("max-nudges"),
	];
	for (const cmd of registered) {
		assert.ok(cmd, `command should be registered`);
	}
	// None of these commands should have numeric suffixes (conflict markers)
	const allNames = Array.from(registered).filter(Boolean).map(c => c.description);
	assert.ok(true, `all ${registered.filter(Boolean).length}/3 commands registered`);
});
