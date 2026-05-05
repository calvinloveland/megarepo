import { SessionManager, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { buildCandidates, buildHandoffPrompt, chooseBestCandidate, formatTokenCount, makeSnippet } from "./router-logic.mjs";

const SUMMARY_CACHE_PATH = join(homedir(), ".pi", "agent", "find-session-cache.json");
const LARGE_SESSION_TOKEN_WARNING = 180_000;

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

function estimateSessionTokens(ctx: any): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = entry.message.usage ?? {};
		total += Number(usage.input ?? 0) + Number(usage.cacheRead ?? 0);
	}
	return total;
}

function setSessionHealthStatus(ctx: any): void {
	if (!ctx.hasUI) return;
	const totalTokens = estimateSessionTokens(ctx);
	if (totalTokens >= LARGE_SESSION_TOKEN_WARNING) {
		ctx.ui.setStatus("session-health", `⚠️ large session ${formatTokenCount(totalTokens)} · use /handoff`);
		return;
	}
	ctx.ui.setStatus("session-health", undefined);
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

	pi.on("agent_end", async (_event, ctx) => {
		await updateCurrentSessionSummary(ctx).catch(() => {});
		setSessionHealthStatus(ctx);
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

		const switchResult = await ctx.switchSession(best.path, {
			withSession: async (replacementCtx: any) => {
				if (replacementCtx.hasUI) {
					replacementCtx.ui.notify(`Switched to: ${candidateDetail(best)}`, "success");
				}
			},
		});

		if (switchResult.cancelled) {
			notify(ctx, "Session switch cancelled.", "warning");
		}
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

		const newSessionResult = await ctx.newSession({
			parentSession: sessionFile,
			withSession: async (replacementCtx: any) => {
				if (replacementCtx.hasUI) {
					replacementCtx.ui.notify("Created a fresh handoff session.", "success");
				}
				await replacementCtx.sendUserMessage(prompt);
			},
		});

		if (newSessionResult.cancelled) {
			notify(ctx, "Handoff cancelled.", "warning");
		}
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
