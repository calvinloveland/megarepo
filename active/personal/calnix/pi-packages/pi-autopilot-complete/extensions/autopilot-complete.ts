/**
 * Super autopilot — futureWork-based complete tool
 *
 * The agent provides `futureWork: string[]` — a list of remaining tasks.
 *
 * - Non-empty → each item is queued as a follow-up user message; agent keeps working.
 * - Empty ([]) → the task is truly complete.
 *
 * Super autopilot mode automates the "what's next? → implement → repeat" loop:
 * - After each non-empty futureWork, the extension automatically sends a
 *   "what's next?" prompt and the agent proposes + implements the next task.
 * - Cycle repeats until the agent calls `complete({ futureWork: [] })`.
 * - Max 50 super-autopilot iterations to prevent runaway loops.
 *
 * Runtime control:
 * - /autopilot on|off|toggle|status
 * - /superautopilot on|off|toggle|status
 * - /max-nudges [N|reset]
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AUTOPILOT_STATE_TYPE, getAutopilotEnabled, isTddModeEnabled } from "./autopilot-mode-state.mjs";

const MAX_NUDGES_DEFAULT = 2;
const MAX_NUDGES_STATE_TYPE = "max-nudges-state";
let maxNudges = MAX_NUDGES_DEFAULT;

// Super autopilot constants
const SUPER_AUTOPILOT_STATE_TYPE = "super-autopilot-state";
const MAX_SUPER_AUTOPILOT_ITERATIONS = 50;

let autopilotEnabled = true;
let autopilotSuppressedByTdd = false;
let completedWithFutureWork = false; // true when agent called complete (either empty or non-empty)
let autopilotNudges = 0;

let superAutopilotEnabled = false;
let lastFutureWork: string[] | null = null;
let superAutopilotIterations = 0;

function getSuperAutopilotEnabled(entries: any[] = []): boolean {
	return latestEnabled(entries, SUPER_AUTOPILOT_STATE_TYPE, false);
}

function latestEnabled(entries: any[] = [], customType: string, defaultValue: boolean): boolean {
	let value = defaultValue;
	for (const entry of entries) {
		if (entry?.type === "custom" && entry.customType === customType) {
			value = Boolean(entry.data?.enabled);
		}
	}
	return value;
}

function refreshAutopilotState(ctx: { sessionManager: { getEntries: () => any[] } }) {
	const entries = ctx.sessionManager.getEntries();
	autopilotSuppressedByTdd = isTddModeEnabled(entries);
	autopilotEnabled = getAutopilotEnabled(entries);
	superAutopilotEnabled = getSuperAutopilotEnabled(entries);

	// Read persisted max-nudges value
	maxNudges = MAX_NUDGES_DEFAULT;
	for (const entry of entries) {
		if (entry?.type === "custom" && entry.customType === MAX_NUDGES_STATE_TYPE) {
			const v = Number(entry.data?.maxNudges);
			if (Number.isInteger(v) && v > 0 && v <= 100) {
				maxNudges = v;
			}
		}
	}
}

function setAutopilotStatus(ctx: { hasUI: boolean; ui: { setStatus: (key: string, value?: string) => void } }) {
	if (!ctx.hasUI) return;
	if (superAutopilotEnabled) {
		ctx.ui.setStatus(
			"autopilot",
			`🚀 super autopilot ${superAutopilotIterations}/${MAX_SUPER_AUTOPILOT_ITERATIONS}`,
		);
	} else {
		ctx.ui.setStatus(
			"autopilot",
			autopilotSuppressedByTdd
				? "🤖 autopilot off (TDD)"
				: autopilotEnabled
					? "🤖 autopilot active"
					: "🤖 autopilot off",
		);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		autopilotEnabled = true;
		autopilotSuppressedByTdd = false;
		completedWithFutureWork = false;
		autopilotNudges = 0;
		superAutopilotEnabled = false;
		lastFutureWork = null;
		superAutopilotIterations = 0;

		refreshAutopilotState(ctx);
		setAutopilotStatus(ctx);
	});

	// Reset nudge counter on every user-initiated message
	pi.on("input", async (_event, _ctx) => {
		autopilotNudges = 0;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		completedWithFutureWork = false;
		lastFutureWork = null;
		// autopilotNudges intentionally NOT reset here — reset only in
		// session_start and input event, so nudge-triggered turns don't
		// defeat the limit.
		refreshAutopilotState(ctx);
		setAutopilotStatus(ctx);

		let extraPrompt = "";

		if (autopilotEnabled) {
			extraPrompt += `\n\nAutopilot mode is active. Keep working until you can call the \`complete\` tool. Do not end with a normal assistant response when you can still inspect files, run commands, edit code, or verify results. If you are blocked or need user input, still call \`complete\` and clearly explain what is blocking you. The \`complete\` tool is your required final action for this task.`;
		}

		if (superAutopilotEnabled) {
			extraPrompt += `

SUPER AUTOPILOT MODE IS ACTIVE (iteration ${superAutopilotIterations + 1}/${MAX_SUPER_AUTOPILOT_ITERATIONS}).

You are operating in a continuous improvement loop. Each cycle works like this:
1. **What's next?** Assess the current project state and identify the single next most valuable task.
2. **Implement** that task fully — code, tests, and any needed documentation.
3. **Call complete** with \`futureWork\` listing the next tasks when done — this triggers the next iteration.

Rules:
- After each feature, call \`complete({ futureWork: ["<next task>", ...] })\` to keep the loop going.
- **NEVER call complete with futureWork [].** There is always more to do. Instead of deciding the project is "done", brainstorm what else could be improved, added, refactored, or documented. If you truly cannot think of a single thing, still call \`complete\` with futureWork listing what you considered — the user will decide when to stop.
- If you are blocked or need user input, call \`complete({ futureWork: [] })\` to stop the loop and explain what you need in the summary.
- Each cycle: propose what you'll do (1-2 sentences), then implement it, then call complete with the next futureWork items.
- Before calling complete with [], pause and ask yourself: "Can I think of even one more thing to do?" If yes, do it and call complete with that item.`;
		}

		if (extraPrompt) {
			return { systemPrompt: event.systemPrompt + extraPrompt };
		}
	});

	pi.registerTool({
		name: "complete",
		label: "Complete",
		description: `Signal task completion with a list of remaining work items.

REQUIRED: \`futureWork\` — array of remaining task descriptions.
- Non-empty → items are queued as follow-up tasks; agent keeps working.
- Empty ([]) → the task is complete (or blocked/needs_input — explain in summary).`,
		promptSnippet: "Signal task completion — futureWork items continue, empty array signals done",
		promptGuidelines: [
			"Use complete with futureWork when finishing a unit of work.",
			"futureWork is REQUIRED — always provide it. Use [] when no more work remains.",
			"futureWork with items → agent continues on those tasks.",
			"futureWork is empty → task is complete.",
			"Use summary to briefly log what was accomplished or what is blocking progress.",
		],
		parameters: Type.Object({
			futureWork: Type.Array(
				Type.String({ description: "One remaining work item — specific, actionable, atomic" }),
				{
					description: "REQUIRED. Future work items. Non-empty = continue, empty = done.",
					minItems: 0,
				},
			),
			summary: Type.Optional(
				Type.String({ description: "Optional summary of what was accomplished or what is blocking progress" }),
			),
		}),

		execute(_toolCallId, params) {
			const { futureWork, summary } = params;
			const hasWork = futureWork.length > 0;

			// Track what the agent last called complete with
			lastFutureWork = futureWork;
			completedWithFutureWork = true;

			if (hasWork) {
				// Queue each work item as a follow-up user message
				for (const item of futureWork) {
					pi.sendUserMessage(item, { deliverAs: "followUp" });
				}

				return {
					content: [
						{
							type: "text",
							text: summary
								? `${summary}\n\n→ Continuing with ${futureWork.length} future work item(s).`
								: `→ Continuing with ${futureWork.length} future work item(s).`,
						},
					],
					details: { futureWork, summary: summary ?? null },
				};
			}

			// Empty futureWork — true completion
			return {
				content: [
					{
						type: "text",
						text: summary
							? `${summary}\n\n✓ No remaining work. Task complete.`
							: "✓ No remaining work. Task complete.",
					},
				],
				details: { futureWork: [], summary: summary ?? null },
				terminate: true,
			};
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		refreshAutopilotState(ctx);

		// ── Super autopilot continuation loop ──
		if (superAutopilotEnabled && completedWithFutureWork && lastFutureWork !== null) {
			const fw = lastFutureWork;
			lastFutureWork = null; // prevent re-triggering

			if (fw.length === 0) {
				// Empty futureWork = done/blocked — stop the loop
				superAutopilotIterations = 0;
				if (ctx.hasUI) {
					ctx.ui.notify("Super autopilot completed — task is done! ✅", "info");
					setAutopilotStatus(ctx);
				}
				return;
			}

			// Non-empty futureWork — continue the loop
			if (superAutopilotIterations >= MAX_SUPER_AUTOPILOT_ITERATIONS) {
				if (ctx.hasUI) {
					ctx.ui.notify("Super autopilot reached max iterations.", "warning");
				}
				return;
			}

			superAutopilotIterations++;

			if (ctx.hasUI) {
				ctx.ui.setStatus(
					"autopilot",
					`🚀 super autopilot ${superAutopilotIterations}/${MAX_SUPER_AUTOPILOT_ITERATIONS}`,
				);
			}

			pi.sendMessage(
				{
					customType: "super-autopilot-prompt",
					content:
						"What's next? Propose and implement the next highest value task. " +
						"Assess the current project state, pick the most impactful next step, and implement it fully. " +
						"When done, call complete with futureWork listing the next tasks. " +
						"Remember: NEVER call complete with futureWork []. There is always another task, improvement, " +
						"refactoring, test, or documentation update to tackle. If you think there's nothing " +
						"left, brainstorm harder — you can always find something. The user will stop the " +
						"loop when ready.",
					display: true,
				},
				{ triggerTurn: true },
			);
			return;
		}

		// ── Regular autopilot nudge (when agent didn't call complete) ──
		if (!autopilotEnabled) return;
		if (completedWithFutureWork) return;
		if (autopilotNudges >= maxNudges) return;

		autopilotNudges += 1;
		pi.sendMessage(
			{
				customType: "autopilot-reminder",
				content:
					"Autopilot reminder: continue working until you can call the complete tool. " +
					"If you are blocked or need user input, call complete with futureWork: [] " +
					"and explain what is needed in the summary.",
				display: false,
			},
			{ triggerTurn: true },
		);

		if (ctx.hasUI) {
			ctx.ui.setStatus("autopilot", `🤖 autopilot nudge ${autopilotNudges}/${maxNudges}`);
		}
	});

	pi.registerCommand("max-nudges", {
		description: "Show or set the maximum autopilot nudges per user message: /max-nudges [N|reset]",
		handler: async (args, ctx) => {
			refreshAutopilotState(ctx);
			const arg = args.trim();

			if (arg === "" || arg === "status") {
				ctx.ui.notify(`Max nudges: ${maxNudges} (default: ${MAX_NUDGES_DEFAULT})`, "info");
				return;
			}

			if (arg === "reset") {
				maxNudges = MAX_NUDGES_DEFAULT;
				pi.appendEntry(MAX_NUDGES_STATE_TYPE, { maxNudges });
				setAutopilotStatus(ctx);
				ctx.ui.notify(`Max nudges reset to ${MAX_NUDGES_DEFAULT}.`, "success");
				return;
			}

			const n = Number(arg);
			if (!Number.isInteger(n) || n < 1 || n > 100) {
				ctx.ui.notify("Usage: /max-nudges [N|reset] — N must be an integer 1–100", "error");
				return;
			}

			maxNudges = n;
			pi.appendEntry(MAX_NUDGES_STATE_TYPE, { maxNudges });
			setAutopilotStatus(ctx);
			ctx.ui.notify(`Max nudges set to ${maxNudges}.`, "success");
		},
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

	pi.registerCommand("superautopilot", {
		description:
			"Control super autopilot mode: on, off, toggle, status. Super autopilot automates the 'what's next? → implement → repeat' loop.",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			refreshAutopilotState(ctx);

			if (action === "" || action === "status") {
				ctx.ui.notify(
					`Super autopilot is ${superAutopilotEnabled ? "ON" : "OFF"}. ` +
						`(${superAutopilotIterations}/${MAX_SUPER_AUTOPILOT_ITERATIONS} iterations used)`,
					"info",
				);
				setAutopilotStatus(ctx);
				return;
			}

			let nextEnabled = superAutopilotEnabled;
			if (action === "on") {
				nextEnabled = true;
			} else if (action === "off") {
				nextEnabled = false;
			} else if (action === "toggle") {
				nextEnabled = !superAutopilotEnabled;
			} else {
				ctx.ui.notify("Usage: /superautopilot [on|off|toggle|status]", "error");
				return;
			}

			if (nextEnabled) {
				superAutopilotIterations = 0;
				lastFutureWork = null;

				// Super autopilot implies regular autopilot is on
				if (!autopilotEnabled && !autopilotSuppressedByTdd) {
					autopilotEnabled = true;
					pi.appendEntry(AUTOPILOT_STATE_TYPE, { enabled: true });
				}

				superAutopilotEnabled = true;
				pi.appendEntry(SUPER_AUTOPILOT_STATE_TYPE, { enabled: true });
				setAutopilotStatus(ctx);
				ctx.ui.notify("Super autopilot enabled. Send a message to start the loop!", "success");
			} else {
				superAutopilotEnabled = false;
				superAutopilotIterations = 0;
				lastFutureWork = null;
				pi.appendEntry(SUPER_AUTOPILOT_STATE_TYPE, { enabled: false });
				setAutopilotStatus(ctx);
				ctx.ui.notify("Super autopilot disabled.", "info");
			}
		},
	});
}
