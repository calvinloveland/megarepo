import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { Type } from "typebox";
import { inspectTestFiles, truncateOutput } from "./tdd-mode-utils.mjs";
import { AUTOPILOT_STATE_TYPE } from "./mode-state.mjs";
import * as tddRunState from "./tdd-run-state.mjs";
import { getCompatibleTddStatusLabel, recordCompatibleGreenPhase } from "./tdd-run-state-compat.mjs";
import { syncTddToolNames } from "./tdd-tool-state.mjs";

const MAX_NUDGES = 2;
const TURN_REMINDER_TYPE = "tdd-turn-reminder";
const TURN_REMINDER_TEXT =
	"TDD reminder for this request: before implementation, create or update tests and then call `test_register` with a failing test command.";

let tddEnabled = false;
let activeRun: {
	task: string;
	startedAt: number;
	phase: string;
	registeredFailingTest: {
		testCommand: string;
		testFiles: string[];
		exitCode: number;
		stdout: string;
		stderr: string;
	} | null;
} | null = null;
let sawTddCompleteThisRun = false;
let sawTestRegisterThisRun = false;
let registeredFailingTest:
	| {
			testCommand: string;
			testFiles: string[];
			exitCode: number;
			stdout: string;
			stderr: string;
		}
	| undefined;
let tddNudges = 0;
let turnStartedAt = 0;

function currentState() {
	return { enabled: tddEnabled, activeRun };
}

function persistState(pi: ExtensionAPI) {
	pi.appendEntry(tddRunState.TDD_STATE_TYPE, currentState());
}

function loadState(ctx: { sessionManager: { getEntries: () => any[] } }) {
	const state = tddRunState.buildRuntimeStateFromEntries(ctx.sessionManager.getEntries());
	tddEnabled = state.enabled;
	activeRun = state.activeRun;
	registeredFailingTest = activeRun?.registeredFailingTest ?? undefined;
}

function setTddStatus(ctx: { hasUI: boolean; ui: { setStatus: (key: string, value?: string) => void } }) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("tdd", getCompatibleTddStatusLabel(tddRunState.getTddStatusLabel, currentState()));
}

function syncTddToolActivation(pi: ExtensionAPI) {
	pi.setActiveTools(syncTddToolNames(pi.getActiveTools(), tddEnabled));
}

function tddModeOffResult() {
	return {
		content: [{ type: "text", text: "TDD mode is off. Use the normal workflow and finish with `complete` instead." }],
		details: { enabled: false, reason: "tdd_mode_off" },
	};
}

function notify(
	ctx: { hasUI: boolean; ui: { notify: (message: string, level: "info" | "warning" | "error" | "success") => void } },
	message: string,
	level: "info" | "warning" | "error" | "success",
) {
	if (!ctx.hasUI) return;
	ctx.ui.notify(message, level);
}

async function runShellCommand(command: string, cwd: string, signal?: AbortSignal) {
	return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn("bash", ["-lc", command], {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
	});
}

export default function tddModeExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		loadState(ctx);
		sawTddCompleteThisRun = false;
		sawTestRegisterThisRun = false;
		registeredFailingTest = undefined;
		tddNudges = 0;
		turnStartedAt = 0;
		syncTddToolActivation(pi);
		setTddStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		loadState(ctx);
		sawTddCompleteThisRun = false;
		sawTestRegisterThisRun = false;
		tddNudges = 0;
		turnStartedAt = Date.now();
		if (tddEnabled) {
			activeRun = tddRunState.startRun(currentState(), event.prompt, turnStartedAt).activeRun;
			persistState(pi);
		} else {
			registeredFailingTest = undefined;
		}
		syncTddToolActivation(pi);
		setTddStatus(ctx);

		if (!tddEnabled) return;

		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nTest-Driven Development mode is active. For coding tasks, first write or update tests for the user's request, then register a failing test run with the `test_register` tool, then implement code to make those tests pass, then clean up/refactor, then rerun the tests. Do not finish with a normal assistant message when more TDD work remains. Your required final actions are: first `test_register` with a failing test command for the new/updated tests, then `tdd_complete` with `status: \"done\"`, a passing `testCommand`, and the list of changed test files. If you are blocked or need user input, call `tdd_complete` with `status: \"blocked\"` or `status: \"needs_input\"`. Also, right after reading the user's request, remind yourself to register the failing test before implementation.",
		};
	});

	pi.on("input", async (event, ctx) => {
		loadState(ctx);
		if (!tddEnabled) return { action: "continue" };
		if (event.source === "extension") return { action: "continue" };
		if (event.text.trim().startsWith("/")) return { action: "continue" };

		pi.sendMessage(
			{
				customType: TURN_REMINDER_TYPE,
				content: TURN_REMINDER_TEXT,
				display: false,
			},
			{ triggerTurn: false },
		);
		return { action: "continue" };
	});

	pi.registerTool({
		name: "test_register",
		label: "Register failing test",
		description: "Record the red phase of TDD by running a test command that must currently fail before implementation work is considered complete.",
		promptSnippet: "Register the failing test run before implementing the fix.",
		promptGuidelines: [
			"Call test_register after writing or updating tests and before claiming the task is done.",
			"The provided test command must fail right now to prove the red phase happened.",
			"List the test files involved in the failing test run.",
		],
		parameters: Type.Object({
			testCommand: Type.String({ description: "Shell command that currently fails because the implementation is not finished yet" }),
			testFiles: Type.Optional(Type.Array(Type.String(), { description: "Test files created or updated for this task" })),
			summary: Type.Optional(Type.String({ description: "Optional short note about what the failing test covers" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			loadState(ctx);
			syncTddToolActivation(pi);
			if (!tddEnabled) {
				return tddModeOffResult();
			}

			const testCommand = `${params.testCommand ?? ""}`.trim();
			const testFiles = params.testFiles ?? [];
			if (!testCommand) {
				return {
					content: [{ type: "text", text: "test_register blocked: `testCommand` is required." }],
					details: { registered: false, reason: "missing_test_command" },
				};
			}
			if (testFiles.length === 0) {
				return {
					content: [{ type: "text", text: "test_register blocked: list at least one relevant test file in `testFiles`." }],
					details: { registered: false, reason: "missing_test_files" },
				};
			}

			const inspected = await inspectTestFiles(testFiles, ctx.cwd, turnStartedAt);
			if (inspected.missing.length > 0) {
				return {
					content: [{ type: "text", text: `test_register blocked: missing test files: ${inspected.missing.join(", ")}` }],
					details: { registered: false, reason: "missing_test_files", inspected },
				};
			}
			if (inspected.changedThisRun.length === 0) {
				return {
					content: [{ type: "text", text: "test_register blocked: none of the listed test files appear to have been created or modified during this run." }],
					details: { registered: false, reason: "tests_not_updated_this_run", inspected },
				};
			}

			const result = await runShellCommand(testCommand, ctx.cwd, signal);
			if (result.exitCode === 0) {
				return {
					content: [{ type: "text", text: "test_register blocked: the provided test command passed, but TDD red phase requires a failing test run." }],
					details: {
						registered: false,
						reason: "test_command_did_not_fail",
						exitCode: result.exitCode,
						stdout: truncateOutput(result.stdout),
						stderr: truncateOutput(result.stderr),
						inspected,
					},
				};
			}

			sawTestRegisterThisRun = true;
			registeredFailingTest = {
				testCommand,
				testFiles: inspected.resolved,
				exitCode: result.exitCode,
				stdout: truncateOutput(result.stdout),
				stderr: truncateOutput(result.stderr),
			};
			if (!activeRun) {
				activeRun = tddRunState.startRun(currentState(), "current task", turnStartedAt || Date.now()).activeRun;
			}
			activeRun = tddRunState.recordRedPhase(currentState(), registeredFailingTest).activeRun;
			persistState(pi);
			setTddStatus(ctx);
			return {
				content: [{ type: "text", text: `Registered failing test run (${result.exitCode}): ${params.summary ?? testCommand}` }],
				details: {
					registered: true,
					summary: params.summary ?? "",
					testCommand,
					testFiles: inspected.resolved,
					changedThisRun: inspected.changedThisRun,
					exitCode: result.exitCode,
					stdout: truncateOutput(result.stdout),
					stderr: truncateOutput(result.stderr),
				},
			};
		},
	});

	pi.registerTool({
		name: "admit_failure",
		label: "Admit Failure",
		description: "End the turn when TDD mode is active but you cannot follow the required TDD workflow for this request.",
		promptSnippet: "Admit that you could not follow the required TDD workflow and terminate the turn.",
		promptGuidelines: [
			"Use admit_failure as the final action when TDD mode is active but you cannot honestly finish through the required TDD flow.",
			"Use admit_failure instead of pretending TDD happened or forcing tdd_complete without the required red and green checks.",
			"When calling admit_failure, clearly explain why you could not follow TDD and what should happen next.",
		],
		parameters: Type.Object({
			summary: Type.String({ description: "Concise explanation of why the model could not follow TDD for this turn" }),
			nextSteps: Type.Optional(Type.Array(Type.String(), { description: "Optional recovery steps or follow-up actions" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			loadState(ctx);
			syncTddToolActivation(pi);
			if (!tddEnabled) {
				return tddModeOffResult();
			}

			sawTddCompleteThisRun = true;
			setTddStatus(ctx);
			return {
				content: [{ type: "text", text: `admit_failure: ${params.summary}` }],
				details: {
					status: "admit_failure",
					summary: params.summary,
					nextSteps: params.nextSteps ?? [],
				},
				terminate: true,
			};
		},
	});

	pi.registerTool({
		name: "tdd_complete",
		label: "TDD Complete",
		description: "Finish a TDD-mode task. For done status, verifies that a failing test was registered this run, that tests were created/updated this run, and that the provided test command now exits successfully.",
		promptSnippet: "Finish the TDD task by calling tdd_complete as the final action.",
		promptGuidelines: [
			"Use tdd_complete as the final action for TDD mode.",
			"Before status 'done', you must have successfully called test_register for this run.",
			"For status 'done', provide the exact test command that should pass now.",
			"List the test files that were created or updated for this task.",
			"If verification fails, keep working until tests pass.",
		],
		parameters: Type.Object({
			status: Type.Union([Type.Literal("done"), Type.Literal("blocked"), Type.Literal("needs_input")]),
			summary: Type.String({ description: "Concise summary of what was accomplished or what is blocking progress" }),
			testCommand: Type.Optional(Type.String({ description: "Shell command that runs the relevant tests for this task" })),
			testFiles: Type.Optional(Type.Array(Type.String(), { description: "Test files created or updated for this task" })),
			nextSteps: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			loadState(ctx);
			syncTddToolActivation(pi);
			if (!tddEnabled) {
				return tddModeOffResult();
			}

			if (params.status !== "done") {
				sawTddCompleteThisRun = true;
				setTddStatus(ctx);
				return {
					content: [{ type: "text", text: `${params.status}: ${params.summary}` }],
					details: {
						status: params.status,
						summary: params.summary,
						nextSteps: params.nextSteps ?? [],
					},
					terminate: true,
				};
			}

			const testCommand = `${params.testCommand ?? ""}`.trim();
			const testFiles = params.testFiles ?? [];
			if (!sawTestRegisterThisRun || !registeredFailingTest) {
				return {
					content: [{ type: "text", text: "TDD completion blocked: call `test_register` with a failing test command before finishing with status 'done'." }],
					details: { verified: false, reason: "missing_test_register" },
				};
			}
			if (!testCommand) {
				return {
					content: [{ type: "text", text: "TDD completion blocked: `testCommand` is required for status 'done'." }],
					details: { verified: false, reason: "missing_test_command" },
				};
			}
			if (testFiles.length === 0) {
				return {
					content: [{ type: "text", text: "TDD completion blocked: list at least one created or updated test file in `testFiles`." }],
					details: { verified: false, reason: "missing_test_files" },
				};
			}

			const inspected = await inspectTestFiles(testFiles, ctx.cwd, turnStartedAt);
			if (inspected.missing.length > 0) {
				return {
					content: [{ type: "text", text: `TDD completion blocked: missing test files: ${inspected.missing.join(", ")}` }],
					details: { verified: false, reason: "missing_test_files", inspected },
				};
			}
			if (inspected.changedThisRun.length === 0) {
				return {
					content: [{ type: "text", text: "TDD completion blocked: none of the listed test files appear to have been created or modified during this run." }],
					details: { verified: false, reason: "tests_not_updated_this_run", inspected },
				};
			}

			const result = await runShellCommand(testCommand, ctx.cwd, signal);
			if (result.exitCode !== 0) {
				return {
					content: [{ type: "text", text: `TDD verification failed: test command exited with ${result.exitCode}. Keep working until it passes.` }],
					details: {
						verified: false,
						reason: "test_command_failed",
						exitCode: result.exitCode,
						stdout: truncateOutput(result.stdout),
						stderr: truncateOutput(result.stderr),
						inspected,
					},
				};
			}

			activeRun = recordCompatibleGreenPhase(tddRunState.recordGreenPhase, currentState()).activeRun;
			persistState(pi);
			sawTddCompleteThisRun = true;
			setTddStatus(ctx);
			return {
				content: [{ type: "text", text: `done: ${params.summary}` }],
				details: {
					status: params.status,
					summary: params.summary,
					testCommand,
					testFiles: inspected.resolved,
					changedThisRun: inspected.changedThisRun,
					exitCode: result.exitCode,
					stdout: truncateOutput(result.stdout),
					stderr: truncateOutput(result.stderr),
					registeredFailingTest,
					nextSteps: params.nextSteps ?? [],
				},
				terminate: true,
			};
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		loadState(ctx);
		if (!tddEnabled) return;
		if (sawTddCompleteThisRun) return;
		if (tddNudges >= MAX_NUDGES) return;

		tddNudges += 1;
		pi.sendMessage(
			{
				customType: "tdd-reminder",
				content:
					"TDD reminder: write/update tests first, register the failing test run with test_register, make the tests pass, rerun them after cleanup, and finish with tdd_complete. If you are blocked or need user input, call tdd_complete with status 'blocked' or 'needs_input'.",
				display: false,
			},
			{ triggerTurn: true },
		);

		if (ctx.hasUI) {
			ctx.ui.setStatus("tdd", `🧪 TDD nudge ${tddNudges}/${MAX_NUDGES}`);
		}
	});

	pi.registerCommand("tdd", {
		description: "Control TDD mode: on, off, toggle, status",
		handler: async (args, ctx) => {
			loadState(ctx);
			const action = args.trim().toLowerCase();

			if (action === "" || action === "status") {
				notify(ctx, `TDD mode is ${tddEnabled ? "ON" : "OFF"}.`, "info");
				setTddStatus(ctx);
				return;
			}

			if (action === "on") {
				tddEnabled = true;
			} else if (action === "off") {
				tddEnabled = false;
			} else if (action === "toggle") {
				tddEnabled = !tddEnabled;
			} else {
				notify(ctx, "Usage: /tdd [on|off|toggle|status]", "error");
				return;
			}

			persistState(pi);
			syncTddToolActivation(pi);
			if (tddEnabled) {
				pi.appendEntry(AUTOPILOT_STATE_TYPE, { enabled: false });
				if (ctx.hasUI) {
					ctx.ui.setStatus("autopilot", "🤖 autopilot off (TDD)");
				}
			}
			setTddStatus(ctx);
			notify(ctx, `TDD mode ${tddEnabled ? "enabled" : "disabled"}.`, "success");
			if (tddEnabled) {
				notify(ctx, "Autopilot disabled because TDD mode is active.", "info");
			}
		},
	});
}
