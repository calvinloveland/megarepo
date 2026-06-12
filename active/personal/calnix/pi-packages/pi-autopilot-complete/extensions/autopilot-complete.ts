/**
 * Super autopilot — futureWork-based complete tool
 *
 * The agent provides `futureWork: string[]` — a list of remaining tasks.
 *
 * - Non-empty → the extension queues the next cycle mechanically via Pi's
 *   follow-up queue; agent keeps working.
 * - Empty ([]) → the task is truly complete.
 *
 * Super autopilot mode automates the "what's next? → implement → repeat" loop:
 * - After each non-empty futureWork, the extension queues a follow-up
 *   `=== NEXT TASK ===` message from inside the complete tool.
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
import { createLogger } from "../../shared-utils/logger.mjs";

// ── Extension constants and logging ──
const EXTENSION_VERSION = "0.4.0";
const log = createLogger("autopilot-complete");
log("=== Extension loaded v" + EXTENSION_VERSION + " ===");

// ── Helper state (inlined from autopilot-mode-state.mjs to avoid broken
//    relative imports when the extension is loaded through a symlink) ──

const AUTOPILOT_STATE_TYPE = "autopilot-state";
const TDD_STATE_TYPE = "tdd-mode-state";

function isTddModeEnabled(entries: any[] = []): boolean {
	return latestEnabled(entries, TDD_STATE_TYPE, false);
}

function getAutopilotEnabled(entries: any[] = []): boolean {
	if (isTddModeEnabled(entries)) return false;
	return latestEnabled(entries, AUTOPILOT_STATE_TYPE, true);
}

function latestEnabled(entries: any[], customType: string, defaultValue: boolean): boolean {
	let value = defaultValue;
	for (const entry of entries) {
		if (entry?.type === "custom" && entry.customType === customType) {
			value = Boolean(entry.data?.enabled);
		}
	}
	return value;
}

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
let superAutopilotLimitReached = false;

function getSuperAutopilotEnabled(entries: any[] = []): boolean {
	return latestEnabled(entries, SUPER_AUTOPILOT_STATE_TYPE, false);
}

function refreshAutopilotState(ctx: { sessionManager: { getEntries: () => any[] } }) {
	const entries = ctx.sessionManager.getEntries();
	autopilotSuppressedByTdd = isTddModeEnabled(entries);
	autopilotEnabled = getAutopilotEnabled(entries);
	superAutopilotEnabled = getSuperAutopilotEnabled(entries);
	log("refreshAutopilotState → autopilot:", autopilotEnabled, "tdd:", autopilotSuppressedByTdd, "super:", superAutopilotEnabled);

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
		log("=== session_start ===");
		autopilotEnabled = true;
		autopilotSuppressedByTdd = false;
		completedWithFutureWork = false;
		autopilotNudges = 0;
		superAutopilotEnabled = false;
		lastFutureWork = null;
		superAutopilotIterations = 0;
		superAutopilotLimitReached = false;

		refreshAutopilotState(ctx);
		setAutopilotStatus(ctx);
	});

	// Reset nudge counter on every user-initiated message
	pi.on("input", async (_event, _ctx) => {
		autopilotNudges = 0;
	});

	// Reset per-turn completion tracking here, not in before_agent_start.
	// Auto-follow-up turns queued from the complete tool do NOT pass through
	// before_agent_start, but they do emit turn_start.
	// We preserve lastFutureWork so agent_end can still detect empty futureWork
	// and send the completion notification. Only completedWithFutureWork is reset
	// so the nudge can fire if the agent stops without calling complete in this turn.
	pi.on("turn_start", async (_event, _ctx) => {
		completedWithFutureWork = false;
		superAutopilotLimitReached = false;
		log("=== turn_start === reset per-turn complete state (preserved lastFutureWork)");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		log("=== before_agent_start ===", "super:", superAutopilotEnabled, "autopilot:", autopilotEnabled, "iter:", superAutopilotIterations);
		// autopilotNudges intentionally NOT reset here — reset only in
		// session_start and input event, so nudge-triggered turns don't
		// defeat the limit.
		refreshAutopilotState(ctx);
		setAutopilotStatus(ctx);

		let extraPrompt = "";

		if (autopilotEnabled && !superAutopilotEnabled) {
			extraPrompt += `\n\nAutopilot mode is active. Keep working until you can call the \`complete\` tool. Do not end with a normal assistant response when you can still inspect files, run commands, edit code, or verify results. If you are blocked or need user input, still call \`complete\` with futureWork: [] and explain what is blocking you in the summary. The \`complete\` tool is your required final action for the current cycle. If \`futureWork\` is non-empty, the extension automatically queues the next turn for you.`;
			log("before_agent_start: added autopilot prompt");
		}

		if (superAutopilotEnabled) {
			log("before_agent_start: adding super autopilot prompt");
			extraPrompt += `

SUPER AUTOPILOT MODE IS ACTIVE (iteration ${superAutopilotIterations + 1}/${MAX_SUPER_AUTOPILOT_ITERATIONS}).

You are operating in a continuous improvement loop. Each cycle:
1. Implement the current task fully — code, tests, docs.
2. Call \`complete({ futureWork: ["<next task>", ...] })\` when that cycle is done.
3. The extension automatically queues a follow-up \`=== NEXT TASK ===\` message when \`futureWork\` is non-empty.
4. Continue immediately with the first task in that queued block.

**CRITICAL: Treat every queued \`=== NEXT TASK ===\` block as a direct instruction. Work on the first item, then find the next most valuable work and put it in \`futureWork\`. Do not stop, do not summarize to the user, and do not wait for user input unless you are actually blocked. Only call complete with futureWork: [] when you truly need to stop.**`;
		}

		if (extraPrompt) {
			log("before_agent_start: returning enhanced system prompt (+" + extraPrompt.length + " chars)");
			return { systemPrompt: event.systemPrompt + extraPrompt };
		}
		log("before_agent_start: no extra prompt added");
	});

	pi.registerTool({
		name: "complete",
		label: "Complete",
		description: `Signal task completion with a list of remaining work items.

REQUIRED: \`futureWork\` — array of remaining task descriptions.
- Non-empty → extension queues the next cycle automatically.
- Empty ([]) → the task is complete. Use summary to explain why (e.g., blocked, needs input, all done).`,
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

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { futureWork, summary } = params;
			const hasWork = futureWork.length > 0;

			// Track what the agent last called complete with
			lastFutureWork = futureWork;
			completedWithFutureWork = true;

			log("complete execute: futureWork has", futureWork.length, "items:", futureWork, "super:", superAutopilotEnabled);

			if (hasWork) {
				const itemsText = futureWork.map((item: string, i: number) => `${i + 1}. ${item}`).join("\n");

				// Safety limit: super autopilot hard stop
				if (superAutopilotEnabled && superAutopilotIterations >= MAX_SUPER_AUTOPILOT_ITERATIONS) {
					superAutopilotLimitReached = true;
					log("complete execute: max super iterations reached");
					return {
						content: [{
							type: "text",
							text: summary
								? `${summary}\n\nReached the super autopilot safety limit (${MAX_SUPER_AUTOPILOT_ITERATIONS}).`
								: `Reached the super autopilot safety limit (${MAX_SUPER_AUTOPILOT_ITERATIONS}).`,
						}],
						details: { futureWork, summary: summary ?? null, limitReached: true },
						terminate: true,
					};
				}

				if (superAutopilotEnabled) {
					superAutopilotIterations += 1;
					log("complete execute: incremented super iteration to", superAutopilotIterations);
					if (ctx?.hasUI) {
						ctx.ui.setStatus(
							"autopilot",
							`🚀 super autopilot ${superAutopilotIterations}/${MAX_SUPER_AUTOPILOT_ITERATIONS}`,
						);
					}
				}

				// Same-turn approach: include the task prompt in the tool output
				// and DON'T terminate. The model sees the result and continues
				// working in the same agent turn.
				const promptText = superAutopilotEnabled
					? `=== NEXT TASK ===\n${itemsText}\n\nProceed immediately. The turn continues — work on the first task, then call complete again with more futureWork.`
					: `=== NEXT TASK ===\n${itemsText}`;

				const contentText = summary
					? `${summary}\n\n${promptText}`
					: promptText;

				return {
					content: [{ type: "text", text: contentText }],
					details: { futureWork, summary: summary ?? null },
					// NOT terminating — agent continues in the same turn
				};
			}

			// Empty futureWork — true completion
			const doneText = summary
				? `${summary}\n\n✓ No remaining work. Task complete.`
				: "✓ No remaining work. Task complete.";

			return {
				content: [{ type: "text", text: doneText }],
				details: { futureWork: [], summary: summary ?? null },
				terminate: true,
			};
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		log(
			"=== agent_end ===",
			"super:", superAutopilotEnabled,
			"completed:", completedWithFutureWork,
			"lastFW:", lastFutureWork,
			"isIdle:", ctx.isIdle?.(),
			"hasPending:", ctx.hasPendingMessages?.(),
		);
		refreshAutopilotState(ctx);
		log("agent_end: after refresh — super:", superAutopilotEnabled, "completed:", completedWithFutureWork, "lastFW:", lastFutureWork);

		// ── Super autopilot: final run bookkeeping ──
		// Auto-follow-up turns happen inside a single agent run, so agent_end only
		// fires once the queue is exhausted (or the run truly stops).
		if (superAutopilotEnabled && completedWithFutureWork && lastFutureWork !== null) {
			const fw = lastFutureWork;

			if (superAutopilotLimitReached) {
				log("agent_end: super autopilot stopped at safety limit");
				if (ctx.hasUI) {
					ctx.ui.notify(`Super autopilot reached the ${MAX_SUPER_AUTOPILOT_ITERATIONS}-iteration safety limit.`, "warning");
					setAutopilotStatus(ctx);
				}
				return;
			}

			if (fw.length === 0) {
				log("agent_end: futureWork empty — stopping super loop");
				superAutopilotIterations = 0;
				if (ctx.hasUI) {
					ctx.ui.notify("Super autopilot completed — task is done! ✅", "info");
					setAutopilotStatus(ctx);
				}
				return;
			}

			log("agent_end: super autopilot run ended with pending futureWork but no follow-up queued", fw);
			return;
		}

		// ── Regular autopilot nudge (when agent didn't call complete) ──
		// When super autopilot is active, use a much higher nudge limit so the
		// loop keeps prodding the agent until it completes properly, rather than
		// hitting the default maxNudges (2) and going silent.
		const effectiveMaxNudges = superAutopilotEnabled ? MAX_SUPER_AUTOPILOT_ITERATIONS : maxNudges;
		log("agent_end: regular nudge path — autopilot:", autopilotEnabled, "completed:", completedWithFutureWork, "nudges:", autopilotNudges, "max:", effectiveMaxNudges);
		if (!autopilotEnabled) {
			log("agent_end: autopilot disabled, returning");
			return;
		}
		if (completedWithFutureWork) {
			log("agent_end: complete was called, returning (no nudge)");
			return;
		}
		if (autopilotNudges >= effectiveMaxNudges) {
			log("agent_end: max nudges reached, returning");
			return;
		}

		autopilotNudges += 1;
		log("agent_end: sending nudge", autopilotNudges);
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
			ctx.ui.setStatus("autopilot", `🤖 autopilot nudge ${autopilotNudges}/${effectiveMaxNudges}`);
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
				ctx.ui.notify(`Autopilot is ${status} [ext v${EXTENSION_VERSION}]`, "info");
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
			log("=== superautopilot command ===", action);
			refreshAutopilotState(ctx);

			if (action === "" || action === "status") {
				const msg = `Super autopilot is ${superAutopilotEnabled ? "ON" : "OFF"}. ` +
					`(${superAutopilotIterations}/${MAX_SUPER_AUTOPILOT_ITERATIONS} iterations used) ` +
					`[ext v${EXTENSION_VERSION}]`;
				log("superautopilot status:", msg);
				ctx.ui.notify(msg, "info");
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
				log("superautopilot: enabling, resetting iterations");
				superAutopilotIterations = 0;
				lastFutureWork = null;
				superAutopilotLimitReached = false;

				// Super autopilot implies regular autopilot is on
				if (!autopilotEnabled && !autopilotSuppressedByTdd) {
					autopilotEnabled = true;
					pi.appendEntry(AUTOPILOT_STATE_TYPE, { enabled: true });
					log("superautopilot: also enabled regular autopilot");
				}

				superAutopilotEnabled = true;
				pi.appendEntry(SUPER_AUTOPILOT_STATE_TYPE, { enabled: true });
				setAutopilotStatus(ctx);
				ctx.ui.notify("Super autopilot enabled. Send a message to start the loop!", "success");
				log("superautopilot: enabled successfully");
			} else {
				log("superautopilot: disabling");
				superAutopilotEnabled = false;
				superAutopilotIterations = 0;
				lastFutureWork = null;
				superAutopilotLimitReached = false;
				pi.appendEntry(SUPER_AUTOPILOT_STATE_TYPE, { enabled: false });
				setAutopilotStatus(ctx);
				ctx.ui.notify("Super autopilot disabled.", "info");
			}
		},
	});
}
