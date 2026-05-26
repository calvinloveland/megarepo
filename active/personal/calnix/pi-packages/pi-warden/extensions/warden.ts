/**
 * pi-warden — Pi extension for the Warden per-host monitoring agent.
 *
 * Provides tools and commands for querying host health, running checks,
 * communicating with peer wardens, and managing backups — all from inside Pi.
 *
 * Tools (LLM-callable):
 *   - warden_status        Get full host health summary
 *   - warden_check         Run a specific health check
 *   - warden_run_checks    Run all configured checks
 *   - warden_peers         List known peer wardens
 *   - warden_peer_status   Query a peer Warden
 *   - warden_backup        Run backup and report status
 *   - warden_tail          Show recent events
 *
 * Commands:
 *   /warden status
 *   /warden check <name>
 *   /warden checks
 *   /warden peers
 *   /warden tail [-f]
 */

import { type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "typebox";

// ── Helpers ────────────────────────────────────────────────────────

async function runWardenctl(
	args: string[],
	pi: ExtensionAPI,
	ctx: { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const result = await pi.exec("wardenctl", args, {
			signal: ctx.signal,
			timeout: 30_000,
		});
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			code: result.code ?? 0,
		};
	} catch (err: any) {
		return {
			stdout: "",
			stderr: err.message ?? String(err),
			code: -1,
		};
	}
}

function parseJsonOutput(stdout: string): Record<string, unknown> | null {
	try {
		return JSON.parse(stdout) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function formatStatus(status: string): string {
	switch (status) {
		case "pass": return "✓";
		case "warn": return "⚠";
		case "fail": return "✗";
		default: return "?";
	}
}

// ── Tool: warden_status ────────────────────────────────────────────

const WardenStatusParams = Type.Object({
	json: Type.Optional(Type.Boolean({ description: "Output raw JSON" })),
});

type WardenStatusParams = Static<typeof WardenStatusParams>;

// ── Tool: warden_check ─────────────────────────────────────────────

const WardenCheckParams = Type.Object({
	check: Type.String({ description: "Name of the check to run (e.g., disk-usage, memory)" }),
	json: Type.Optional(Type.Boolean({ description: "Output raw JSON" })),
});

type WardenCheckParams = Static<typeof WardenCheckParams>;

// ── Tool: warden_peers ─────────────────────────────────────────────

const WardenPeersParams = Type.Object({
	json: Type.Optional(Type.Boolean({ description: "Output raw JSON" })),
});

type WardenPeersParams = Static<typeof WardenPeersParams>;

// ── Tool: warden_peer_status ───────────────────────────────────────

const WardenPeerStatusParams = Type.Object({
	peer: Type.String({ description: "Peer hostname to query" }),
});

type WardenPeerStatusParams = Static<typeof WardenPeerStatusParams>;

// ── Tool: warden_tail ──────────────────────────────────────────────

const WardenTailParams = Type.Object({
	lines: Type.Optional(Type.Integer({ description: "Number of recent events", default: 20 })),
	follow: Type.Optional(Type.Boolean({ description: "Follow new events (live stream)", default: false })),
});

type WardenTailParams = Static<typeof WardenTailParams>;

// ── Tool: warden_backup ────────────────────────────────────────────

const WardenBackupParams = Type.Object({
	repository: Type.Optional(Type.String({ description: "Backup repository name (omit for all)" })),
});

type WardenBackupParams = Static<typeof WardenBackupParams>;

// ── Extension entrypoint ───────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Notify on load ─────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		// Quick check: is wardenctl available?
		const { code } = await runWardenctl(["identify"], pi, ctx);
		if (code !== 0) {
			ctx.ui.setStatus("warden", "⚠ wardenctl not found");
		} else {
			ctx.ui.setStatus("warden", "🛡 warden active");
		}
	});

	// ── Register tools ─────────────────────────────────────────
	pi.registerTool({
		name: "warden_status",
		label: "Warden Status",
		description: "Get the full host health summary from the local Warden agent. Shows check results, last boot time, generation info, backup status, and peer cache.",
		promptSnippet: "Show host health summary from the Warden agent",
		promptGuidelines: [
			"Use warden_status when the user asks about system health, host status, or 'how is the machine doing'.",
			"Use warden_status to get context before running checks or remediation.",
		],
		parameters: WardenStatusParams,

		async execute(_toolCallId: string, params: WardenStatusParams, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const { stdout, stderr, code } = await runWardenctl(["status", "--json"], pi, ctx);
			if (code !== 0) {
				return {
					content: [{ type: "text" as const, text: `Failed to get Warden status: ${stderr}` }],
					details: { error: stderr },
				};
			}

			const data = parseJsonOutput(stdout);
			if (!data) {
				return {
					content: [{ type: "text" as const, text: `Failed to parse Warden status output:\n${stdout}` }],
					details: { error: "parse failure" },
				};
			}

			if (params.json) {
				return {
					content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
					details: data,
				};
			}

			// Build human-readable summary
			const lines: string[] = [];
			const hostname = data.hostname ?? "unknown";
			const hostId = (data.host_id ?? "").slice(0, 8);
			lines.push(`Host: ${hostname} (${hostId})`);
			lines.push(`Boot: ${(data.last_boot ?? "?").toString().slice(0, 19)}`);
			lines.push(`Warden started: ${(data.warden_started ?? "?").toString().slice(0, 19)}`);

			// Checks
			const checks = data.checks as Record<string, any> | undefined;
			if (checks && Object.keys(checks).length > 0) {
				lines.push("");
				lines.push("Health checks:");
				for (const [name, check] of Object.entries(checks).sort()) {
					const s = check as any;
					const sym = formatStatus(s.status ?? "unknown");
					const msg = s.message ?? "";
					const last = (s.last_run ?? "").toString().slice(0, 19);
					lines.push(`  ${sym} ${name}: ${s.status} (${last})`);
					if (msg) lines.push(`     ${msg}`);
				}
			} else {
				lines.push("");
				lines.push("No checks have run yet. Use /warden check all");
			}

			// Generation
			const gen = data.generation as Record<string, any> | undefined;
			if (gen) {
				lines.push("");
				lines.push(`NixOS generation: ${gen.current ?? "?"}`);
				const lastRebuild = gen.last_rebuild as Record<string, any> | undefined;
				if (lastRebuild) {
					lines.push(`  Last rebuild: ${lastRebuild.result} at ${(lastRebuild.timestamp ?? "").toString().slice(0, 19)}`);
				}
			}

			// Backups
			const backups = data.backups as Record<string, any> | undefined;
			if (backups) {
				lines.push("");
				const lastRun = (backups.last_run ?? "").toString();
				lines.push(`Last backup: ${lastRun ? lastRun.slice(0, 19) : "never"}`);
				const repos = backups.repositories as Record<string, any> | undefined;
				if (repos) {
					for (const [name, repo] of Object.entries(repos).sort()) {
						const r = repo as any;
						const last = (r.last_success ?? "").toString().slice(0, 19) || "never";
						lines.push(`  ${name}: last ${last}, ${r.snapshots ?? 0} snapshots`);
					}
				}
			}

			// Peers
			const peers = data.peers as Record<string, any> | undefined;
			if (peers && Object.keys(peers).length > 0) {
				lines.push("");
				lines.push("Peers:");
				for (const [name, peer] of Object.entries(peers).sort()) {
					const p = peer as any;
					const last = (p.last_seen ?? "").toString().slice(0, 19) || "?";
					lines.push(`  ${name}: ${p.status ?? "unknown"} (last: ${last})`);
				}
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: data,
			};
		},
	});

	pi.registerTool({
		name: "warden_check",
		label: "Warden Check",
		description: "Run a specific Warden health check by name and get the structured result.",
		promptSnippet: "Run a specific health check (disk-usage, memory, temperature, systemd-health)",
		promptGuidelines: [
			"Use warden_check to run a named health check on demand.",
			"Useful before remediation to get current state.",
		],
		parameters: WardenCheckParams,

		async execute(_toolCallId: string, params: WardenCheckParams, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const { stdout, stderr, code } = await runWardenctl(["check", params.check, "--json"], pi, ctx);
			if (code !== 0) {
				return {
					content: [{ type: "text" as const, text: `Check '${params.check}' failed: ${stderr}` }],
					details: { error: stderr, check: params.check },
				};
			}

			const data = parseJsonOutput(stdout);
			if (!data) {
				return {
					content: [{ type: "text" as const, text: stdout || stderr || `No output from check '${params.check}'` }],
					details: { check: params.check },
				};
			}

			// data is keyed by check name: { "disk-usage": { ... } }
			const checkResult = (data as Record<string, any>)[params.check];
			if (!checkResult) {
				return {
					content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
					details: data,
				};
			}

			if (params.json) {
				return {
					content: [{ type: "text" as const, text: JSON.stringify(checkResult, null, 2) }],
					details: checkResult,
				};
			}

			const sym = formatStatus(checkResult.status ?? "?");
			const msg = checkResult.message ?? "";
			const ts = (checkResult.timestamp ?? "").toString().slice(0, 19);

			return {
				content: [{ type: "text" as const, text: `${sym} ${params.check}: ${checkResult.status} (${ts})\n   ${msg}` }],
				details: checkResult,
			};
		},
	});

	pi.registerTool({
		name: "warden_run_checks",
		label: "Warden Run All Checks",
		description: "Run all configured Warden health checks and return a summary of pass/warn/fail counts with messages.",
		promptSnippet: "Run all Warden health checks and summarize",
		promptGuidelines: [
			"Use warden_run_checks when the user asks to 'run all checks' or wants a full health scan.",
		],
		parameters: Type.Object({}),

		async execute(_toolCallId: string, _params: {}, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const { stdout, stderr, code } = await runWardenctl(["check", "all"], pi, ctx);
			if (code !== 0) {
				return {
					content: [{ type: "text" as const, text: `Checks failed:\n${stderr || stdout}` }],
					details: { error: stderr },
				};
			}

			return {
				content: [{ type: "text" as const, text: stdout }],
				details: { output: stdout },
			};
		},
	});

	pi.registerTool({
		name: "warden_peers",
		label: "Warden Peers",
		description: "List known peer Warden agents and their last-reported status from the local cache.",
		promptSnippet: "List peer Warden agents",
		promptGuidelines: [
			"Use warden_peers to discover other Warden-managed hosts.",
		],
		parameters: WardenPeersParams,

		async execute(_toolCallId: string, params: WardenPeersParams, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const { stdout, stderr, code } = await runWardenctl(["peer", "list"], pi, ctx);
			if (code !== 0) {
				return {
					content: [{ type: "text" as const, text: `Failed to list peers: ${stderr}` }],
					details: { error: stderr },
				};
			}

			return {
				content: [{ type: "text" as const, text: stdout || "No peers configured." }],
				details: { output: stdout },
			};
		},
	});

	pi.registerTool({
		name: "warden_peer_status",
		label: "Warden Peer Status",
		description: "Query a specific peer Warden's health status. Requires peer communication to be configured (Tailscale + HTTP API).",
		promptSnippet: "Query a peer Warden's health",
		promptGuidelines: [
			"Use warden_peer_status when you need to check the health of another host managed by Warden.",
		],
		parameters: WardenPeerStatusParams,

		async execute(_toolCallId: string, params: WardenPeerStatusParams, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const { stdout, stderr, code } = await runWardenctl(["peer", "status", params.peer], pi, ctx);
			if (code !== 0) {
				return {
					content: [{ type: "text" as const, text: `Failed to get peer status for '${params.peer}': ${stderr}` }],
					details: { error: stderr, peer: params.peer },
				};
			}

			const data = parseJsonOutput(stdout);
			if (data) {
				return {
					content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
					details: data,
				};
			}

			return {
				content: [{ type: "text" as const, text: stdout || `No status for peer: ${params.peer}` }],
				details: { peer: params.peer, output: stdout },
			};
		},
	});

	pi.registerTool({
		name: "warden_backup",
		label: "Warden Backup",
		description: "Run a Warden backup job. Optionally specify a repository name. Returns status and duration.",
		promptSnippet: "Run a backup via the Warden",
		promptGuidelines: [
			"Use warden_backup when the user asks to run a backup or check backup status.",
		],
		parameters: WardenBackupParams,

		async execute(_toolCallId: string, params: WardenBackupParams, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const args = ["backup", "run"];
			if (params.repository) {
				args.push("--repository", params.repository);
			}
			const { stdout, stderr, code } = await runWardenctl(args, pi, ctx);
			if (code !== 0) {
				return {
					content: [{ type: "text" as const, text: `Backup failed:\n${stderr || stdout}` }],
					details: { error: stderr, backup: params.repository ?? "all" },
				};
			}

			return {
				content: [{ type: "text" as const, text: stdout || "Backup completed." }],
				details: { output: stdout },
			};
		},
	});

	pi.registerTool({
		name: "warden_tail",
		label: "Warden Event Log",
		description: "Show recent events from the Warden event log. Optionally specify the number of lines.",
		promptSnippet: "Show recent Warden events",
		promptGuidelines: [
			"Use warden_tail to see recent Warden events (checks, remediations, backups, peer alerts).",
		],
		parameters: WardenTailParams,

		async execute(_toolCallId: string, params: WardenTailParams, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
			const args = ["tail"];
			if (params.lines) {
				args.push("-n", String(params.lines));
			}
			if (params.follow) {
				args.push("-f");
			}
			const { stdout, stderr, code } = await runWardenctl(args, pi, ctx);
			if (code !== 0) {
				return {
					content: [{ type: "text" as const, text: `Failed to tail events: ${stderr}` }],
					details: { error: stderr },
				};
			}

			return {
				content: [{ type: "text" as const, text: stdout || "No events." }],
				details: { output: stdout },
			};
		},
	});

	// ── Register commands ──────────────────────────────────────
	pi.registerCommand("warden", {
		description: "Interact with the Warden per-host monitoring agent. Usage: /warden [status|check|checks|peers|tail]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "status";
			const subargs = parts.slice(1);

			switch (subcommand) {
				case "status": {
					const { stdout, stderr, code } = await runWardenctl(["status"], pi, ctx);
					if (code !== 0) {
						ctx.ui.notify(`Warden error: ${stderr}`, "error");
						return;
					}
					ctx.ui.notify("Warden status", "info");
					// Print to the terminal
					ctx.ui.setWidget("warden", stdout.split("\n").slice(0, 20));
					break;
				}

				case "check": {
					const checkName = subargs[0];
					if (!checkName) {
						ctx.ui.notify("Usage: /warden check <name>", "warning");
						return;
					}
					const { stdout, stderr, code } = await runWardenctl(["check", checkName], pi, ctx);
					if (code !== 0) {
						ctx.ui.notify(`Check ${checkName} failed: ${stderr}`, "error");
						return;
					}
					ctx.ui.setWidget("warden", stdout.split("\n").slice(0, 15));
					break;
				}

				case "checks": {
					const { stdout, stderr, code } = await runWardenctl(["checks"], pi, ctx);
					if (code !== 0) {
						ctx.ui.notify(`Error: ${stderr}`, "error");
						return;
					}
					ctx.ui.setWidget("warden", stdout.split("\n").slice(0, 20));
					break;
				}

				case "peers": {
					const { stdout, stderr, code } = await runWardenctl(["peer", "list"], pi, ctx);
					if (code !== 0) {
						ctx.ui.notify(`Error: ${stderr}`, "error");
						return;
					}
					ctx.ui.setWidget("warden", stdout.split("\n").slice(0, 15));
					break;
				}

				case "tail": {
					const nFlag = subargs.includes("-f") ? [] : ["-n", subargs[0] || "20"];
					const followFlag = subargs.includes("-f") ? ["-f"] : [];
					const { stdout, stderr, code } = await runWardenctl(["tail", ...nFlag, ...followFlag], pi, ctx);
					if (code !== 0) {
						ctx.ui.notify(`Error: ${stderr}`, "error");
						return;
					}
					ctx.ui.setWidget("warden", stdout.split("\n").slice(0, 25));
					break;
				}

				case "help":
				default: {
					const help = [
						"Warden commands:",
						"  /warden status        — show host health summary",
						"  /warden check <name>  — run a health check",
						"  /warden checks        — list all checks and status",
						"  /warden peers         — list peer wardens",
						"  /warden tail [-f]     — show recent events",
						"",
						"Available from the LLM as tools:",
						"  warden_status, warden_check, warden_run_checks,",
						"  warden_peers, warden_peer_status, warden_backup, warden_tail",
					];
					ctx.ui.setWidget("warden", help);
					break;
				}
			}
		},
	});
}
