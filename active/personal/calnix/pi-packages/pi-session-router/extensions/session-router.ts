import { SessionManager, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import * as routerLogic from "./router-logic.mjs";

const SUMMARY_CACHE_PATH = join(homedir(), ".pi", "agent", "find-session-cache.json");
const AUTO_COMPACT_REARM_TOKENS = 20_000;

const {
	buildCandidates,
	buildHandoffPrompt,
	chooseBestCandidate,
	formatTokenCount,
	makeSnippet,
} = routerLogic;

type Candidate = {
	key: string;
	path: string;
	name?: string;
	modified: string;
	firstMessage: string;
	snippet: string;
	current: boolean;
	score: number;
	sharedTokens: string[];
};

interface SessionSummaryCacheEntry {
	updatedAt: string;
	summary: string;
}

type SessionSummaryCache = Record<string, SessionSummaryCacheEntry>;

async function readSummaryCache(): Promise<SessionSummaryCache> {
	try {
		return JSON.parse(await readFile(SUMMARY_CACHE_PATH, "utf8")) as SessionSummaryCache;
	} catch {
		return {};
	}
}

async function writeSummaryCache(cache: SessionSummaryCache): Promise<void> {
	await mkdir(dirname(SUMMARY_CACHE_PATH), { recursive: true });
	await writeFile(SUMMARY_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function messageText(message: any): string {
	if (!message) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			if (block.type === "text") return block.text ?? "";
			if (block.type === "thinking") return block.thinking ?? "";
			if (block.type === "toolCall") return `${block.name ?? "tool"} ${JSON.stringify(block.arguments ?? {})}`;
			return "";
		})
		.join(" ")
		.trim();
}

function summarizeBranch(ctx: any, maxMessages = 10, maxChars = 1000): string {
	const branch = ctx.sessionManager.getBranch();
	const lines: string[] = [];
	for (const entry of branch.slice(-maxMessages)) {
		if (entry.type !== "message") continue;
		const role = entry.message.role;
		if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;
		const text = messageText(entry.message);
		if (!text) continue;
		lines.push(`${role}: ${text}`);
	}
	return makeSnippet(lines.join("\n"), maxChars);
}

function summarizeCurrentBranch(ctx: any): string {
	return summarizeBranch(ctx, 10, 1000);
}

function summarizeRecentBranch(ctx: any): string {
	return summarizeBranch(ctx, 6, 700);
}

async function updateCurrentSessionSummary(ctx: any): Promise<void> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return;
	const cache = await readSummaryCache();
	cache[sessionFile] = {
		updatedAt: new Date().toISOString(),
		summary: summarizeCurrentBranch(ctx),
	};
	await writeSummaryCache(cache);
}

function notify(ctx: any, message: string, level: "info" | "warning" | "error" | "success" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	const prefix = level === "error" ? "ERROR" : level === "warning" ? "WARN" : level === "success" ? "OK" : "INFO";
	console.log(`[find-session:${prefix}] ${message}`);
}

function candidateLabel(candidate: Candidate): string {
	return candidate.name?.trim() || candidate.firstMessage.trim() || candidate.path;
}

function candidateDetail(candidate: Candidate): string {
	const shared = candidate.sharedTokens.length > 0 ? ` · shared: ${candidate.sharedTokens.slice(0, 5).join(", ")}` : "";
	return `${candidateLabel(candidate)} (score ${candidate.score}${shared})`;
}

function fallbackDescribeSessionHealth(usage: any = {}) {
	const tokens = Number(usage?.tokens ?? 0);
	const rawPercent = usage?.percent;
	const percent = Number.isFinite(rawPercent) ? Math.round(rawPercent) : null;
	const warning = tokens >= 100_000 || (percent !== null && percent >= 70);
	if (!warning) return null;
	const critical = tokens >= 140_000 || (percent !== null && percent >= 85);
	const summaryParts: string[] = [];
	if (tokens > 0) summaryParts.push(formatTokenCount(tokens));
	if (percent !== null) summaryParts.push(`${percent}% ctx`);
	const summary = summaryParts.join(" · ") || "high context usage";
	return {
		severity: critical ? "critical" : "warning",
		tokens,
		percent,
		shouldAutoCompact: critical,
		statusText: critical ? `🚨 413 risk ${summary} · use /handoff` : `⚠️ large session ${summary} · consider /handoff`,
	};
}

function getSessionHealth(ctx: any) {
	const describeSessionHealth =
		typeof routerLogic.describeSessionHealth === "function"
			? routerLogic.describeSessionHealth
			: fallbackDescribeSessionHealth;
	return describeSessionHealth(ctx.getContextUsage?.());
}

function setSessionHealthStatus(ctx: any): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("session-health", getSessionHealth(ctx)?.statusText);
}

const lastAutoCompactTokensBySession = new Map<string, number>();

function maybeAutoCompact(ctx: any): void {
	const health = getSessionHealth(ctx);
	if (!health?.shouldAutoCompact) return;
	const sessionKey = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
	const lastAutoCompactTokens = lastAutoCompactTokensBySession.get(sessionKey) ?? 0;
	if (health.tokens <= lastAutoCompactTokens + AUTO_COMPACT_REARM_TOKENS) return;
	lastAutoCompactTokensBySession.set(sessionKey, health.tokens);
	notify(ctx, `Session reached ${formatTokenCount(health.tokens)} context tokens. Compacting now to avoid another 413.`, "warning");
	ctx.compact({
		customInstructions:
			"Keep the active task, concrete findings, changed files, pending tests, and blockers. Drop verbose tool output so the next turn stays well below provider request limits.",
		onComplete: () => {
			setSessionHealthStatus(ctx);
			notify(ctx, "Compaction completed. Use /handoff if the session still feels too heavy.", "success");
		},
		onError: (error: Error) => {
			notify(ctx, `Compaction failed: ${error.message}. Use /handoff to continue in a fresh session.`, "error");
		},
	});
}

async function findBestSession(query: string, ctx: any): Promise<Candidate | null> {
	const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
	if (sessions.length === 0) return null;
	const cache = await readSummaryCache();
	const candidates = buildCandidates(sessions, ctx.sessionManager.getSessionFile(), query, cache);
	return chooseBestCandidate(candidates, { minScore: 1, preferNonCurrentOnTie: true });
}

export default function findSessionExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await updateCurrentSessionSummary(ctx).catch(() => {});
		setSessionHealthStatus(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await updateCurrentSessionSummary(ctx).catch(() => {});
		setSessionHealthStatus(ctx);
		maybeAutoCompact(ctx);
	});

	const runFindSession = async (args: string, ctx: any) => {
		const query = args.trim();
		if (!query) {
			notify(ctx, "Usage: /fs <search terms>", "error");
			return;
		}

		await updateCurrentSessionSummary(ctx).catch(() => {});
		const best = await findBestSession(query, ctx);
		if (!best) {
			notify(ctx, `No matching session found for: ${query}`, "warning");
			return;
		}

		if (best.current) {
			notify(ctx, `Already in the best matching session: ${candidateDetail(best)}`, "info");
			return;
		}

		await ctx.switchSession(best.path, {
			withSession: async (replacementCtx: any) => {
				if (replacementCtx.hasUI) {
					replacementCtx.ui.notify(`Switched to: ${candidateDetail(best)}`, "success");
				}
			},
		});
	};

	const runHandoff = async (args: string, ctx: any) => {
		const goal = args.trim();
		if (!goal) {
			notify(ctx, "Usage: /handoff <goal for the new session>", "error");
			return;
		}

		await updateCurrentSessionSummary(ctx).catch(() => {});
		const sessionFile = ctx.sessionManager.getSessionFile();
		const prompt = buildHandoffPrompt({
			sessionLabel: sessionFile ?? "current session",
			summary: summarizeCurrentBranch(ctx),
			recentMessages: summarizeRecentBranch(ctx),
			goal,
		});

		await ctx.newSession({
			parentSession: sessionFile,
			withSession: async (replacementCtx: any) => {
				if (replacementCtx.hasUI) {
					replacementCtx.ui.setEditorText(prompt);
					replacementCtx.ui.notify("Created a fresh handoff session. Review the draft prompt, then send it when ready.", "success");
					return;
				}
				await replacementCtx.sendUserMessage(prompt);
			},
		});
	};

	pi.registerCommand("fs", {
		description: "Find the best matching existing session and switch to it",
		handler: runFindSession,
	});

	pi.registerCommand("find-session", {
		description: "Find the best matching existing session and switch to it",
		handler: runFindSession,
	});

	pi.registerCommand("handoff", {
		description: "Continue in a fresh session using a compact summary of this one",
		handler: runHandoff,
	});
}
