/**
 * Autopilot complete-tool extension
 *
 * Inspired by Copilot Autopilot / done-tool flows:
 * - The model should keep working until it calls the `complete` tool.
 * - If it stops with a normal assistant message, the extension nudges it to continue.
 * - The `complete` tool ends the run with terminate: true, avoiding an extra LLM turn.
 *
 * Runtime control:
 * - /autopilot on
 * - /autopilot off
 * - /autopilot toggle
 * - /autopilot status
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
// Inlined from autopilot-mode-state.mjs to avoid ESM import resolution issues
const AUTOPILOT_STATE_TYPE = "autopilot-state";
const TDD_STATE_TYPE = "tdd-mode-state";

function latestEnabled(entries = [], customType: string, defaultValue: boolean): boolean {
	let value = defaultValue;
	for (const entry of entries) {
		if (entry?.type === "custom" && entry.customType === customType) {
			value = Boolean(entry.data?.enabled);
		}
	}
	return value;
}

function isTddModeEnabled(entries = []): boolean {
	return latestEnabled(entries, TDD_STATE_TYPE, false);
}

function getAutopilotEnabled(entries = []): boolean {
	if (isTddModeEnabled(entries)) return false;
	return latestEnabled(entries, AUTOPILOT_STATE_TYPE, true);
}

const MAX_NUDGES = 2;

let autopilotEnabled = true;
let autopilotSuppressedByTdd = false;
let sawCompleteThisRun = false;
let autopilotNudges = 0;

function refreshAutopilotState(ctx: { sessionManager: { getEntries: () => any[] } }) {
	const entries = ctx.sessionManager.getEntries();
	autopilotSuppressedByTdd = isTddModeEnabled(entries);
	autopilotEnabled = getAutopilotEnabled(entries);
}

function setAutopilotStatus(ctx: { hasUI: boolean; ui: { setStatus: (key: string, value?: string) => void } }) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(
		"autopilot",
		autopilotSuppressedByTdd ? "🤖 autopilot off (TDD)" : autopilotEnabled ? "🤖 autopilot active" : "🤖 autopilot off",
	);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		autopilotEnabled = true;
		autopilotSuppressedByTdd = false;
		sawCompleteThisRun = false;
		autopilotNudges = 0;

		refreshAutopilotState(ctx);
		setAutopilotStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		sawCompleteThisRun = false;
		autopilotNudges = 0;
		refreshAutopilotState(ctx);

		if (!autopilotEnabled) return;

		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nAutopilot mode is active. Keep working until you can call the `complete` tool. Do not end with a normal assistant response when you can still inspect files, run commands, edit code, or verify results. If you are blocked or need user input, still call `complete` and clearly explain what is blocking you. The `complete` tool is your required final action for this task.",
		};
	});

	pi.registerTool({
		name: "complete",
		label: "Complete",
		description:
			"Mark the task complete. Use this as your final action when the request is fully done or when you are blocked and need the user.",
		promptSnippet: "Finish the task by calling complete as the final action.",
		promptGuidelines: [
			"Use complete as the final action when the request is done.",
			"If blocked or you need user input, call complete and explain exactly what is needed.",
			"Do not stop with a plain assistant message when you can still make progress; keep working until complete is appropriate.",
		],
		parameters: Type.Object({
			status: Type.Union([Type.Literal("done"), Type.Literal("blocked"), Type.Literal("needs_input")]),
			summary: Type.String({ description: "Concise summary of what was accomplished or what is blocking progress" }),
			nextSteps: Type.Optional(
				Type.Array(Type.String(), { description: "Optional next steps or required user actions" }),
			),
		}),
		async execute(_toolCallId, params) {
			sawCompleteThisRun = true;
			return {
				content: [{ type: "text", text: `${params.status}: ${params.summary}` }],
				details: {
					status: params.status,
					summary: params.summary,
					nextSteps: params.nextSteps ?? [],
				},
				terminate: true,
			};
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		refreshAutopilotState(ctx);
		if (!autopilotEnabled) return;
		if (sawCompleteThisRun) return;
		if (autopilotNudges >= MAX_NUDGES) return;

		autopilotNudges += 1;
		pi.sendMessage(
			{
				customType: "autopilot-reminder",
				content:
					"Autopilot reminder: continue working until you can call the complete tool. If you are blocked or need user input, call complete with status 'blocked' or 'needs_input' and explain what is needed.",
				display: false,
			},
			{ triggerTurn: true },
		);

		if (ctx.hasUI) {
			ctx.ui.setStatus("autopilot", `🤖 autopilot nudge ${autopilotNudges}/${MAX_NUDGES}`);
		}
	});

	pi.registerCommand("autopilot", {
		description: "Control autopilot mode: on, off, toggle, status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			refreshAutopilotState(ctx);

			if (action === "" || action === "status") {
				const status = autopilotSuppressedByTdd
					? "OFF because TDD mode is active."
					: autopilotEnabled
						? "ON."
						: "OFF.";
				ctx.ui.notify(`Autopilot is ${status}`, "info");
				setAutopilotStatus(ctx);
				return;
			}

			let nextEnabled = autopilotEnabled;
			if (action === "on") {
				nextEnabled = true;
			} else if (action === "off") {
				nextEnabled = false;
			} else if (action === "toggle") {
				nextEnabled = !autopilotEnabled;
			} else {
				ctx.ui.notify("Usage: /autopilot [on|off|toggle|status]", "error");
				return;
			}

			if (nextEnabled && autopilotSuppressedByTdd) {
				autopilotEnabled = false;
				pi.appendEntry(AUTOPILOT_STATE_TYPE, { enabled: false });
				setAutopilotStatus(ctx);
				ctx.ui.notify("Autopilot cannot be enabled while TDD mode is active.", "warning");
				return;
			}

			autopilotEnabled = nextEnabled;
			pi.appendEntry(AUTOPILOT_STATE_TYPE, { enabled: autopilotEnabled });
			setAutopilotStatus(ctx);
			ctx.ui.notify(`Autopilot ${autopilotEnabled ? "enabled" : "disabled"}.`, "success");
		},
	});
}
