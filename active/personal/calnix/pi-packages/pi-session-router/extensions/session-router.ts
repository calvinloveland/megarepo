/**
 * Session router
 *
 * On a new prompt, ask a routing model whether another existing session is more
 * relevant than the current one. If so, switch there first and continue.
 *
 * Features:
 * - /session-router on|off|toggle|status
 * - confidence threshold before switching
 * - heuristic preference for staying in the current session when the prompt
 *   looks like a continuation
 * - automatic new-session creation when no existing session is a good match
 * - lightweight session summary cache for better routing context
 *
 * Implementation note:
 * - This uses an unsupported internal hook: it captures the live AgentSession
 *   instance and calls `createReplacedSessionContext()` from inside the input
 *   interceptor so routing can happen automatically without leaking a fake
 *   internal slash command into the conversation.
 */

import { complete, type Message, type Model } from "@mariozechner/pi-ai";
import { AgentSession, SessionManager, type ExtensionAPI, type SessionInfo } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const STATE_TYPE = "session-router-state";
const MAX_RECENT_SESSIONS = 20;
const MAX_LLM_CANDIDATES = 8;
const MAX_SNIPPET_CHARS = 700;
const SUMMARY_CACHE_PATH = join(homedir(), ".pi", "agent", "session-router-cache.json");
const CONTINUATION_WINDOW_MS = 1000 * 60 * 60 * 6;

interface RoutedPromptPayload {
	text: string;
	images?: Array<Record<string, unknown>>;
}

interface Candidate {
	key: string;
	path: string;
	name?: string;
	modified: string;
	firstMessage: string;
	snippet: string;
	current: boolean;
	score: number;
}

interface RouterDecision {
	choice: string;
	confidence: number;
	reason: string;
}

interface RouterConfig {
	enabled: boolean;
	confidenceThreshold: number;
	createNewSession: boolean;
	showRoutingNotices: boolean;
}

interface SessionSummaryCacheEntry {
	updatedAt: string;
	summary: string;
}

type SessionSummaryCache = Record<string, SessionSummaryCacheEntry>;

const DEFAULT_CONFIG: RouterConfig = {
	enabled: true,
	confidenceThreshold: 0.72,
	createNewSession: true,
	showRoutingNotices: true,
};

let config: RouterConfig = { ...DEFAULT_CONFIG };
let activeAgentSession: AgentSession | null = null;
let agentSessionPatched = false;

function installAgentSessionCapture(): void {
	if (agentSessionPatched) return;
	agentSessionPatched = true;
	const proto = AgentSession.prototype as any;
	const originalPrompt = proto.prompt;
	proto.prompt = async function (...args: any[]) {
		activeAgentSession = this as AgentSession;
		return await originalPrompt.apply(this, args);
	};
}

function tokenize(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? []).slice(0, 64);
}

function scoreSession(promptTokens: string[], info: SessionInfo, cachedSummary?: string): number {
	const hay = `${info.name ?? ""}\n${info.firstMessage}\n${cachedSummary ?? ""}\n${info.allMessagesText}`.toLowerCase();
	let score = 0;
	for (const token of promptTokens) {
		if (hay.includes(token)) score += 1;
	}
	return score;
}

function makeSnippet(text: string, maxChars = MAX_SNIPPET_CHARS): string {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (cleaned.length <= maxChars) return cleaned;
	const head = cleaned.slice(0, Math.floor(maxChars / 2));
	const tail = cleaned.slice(-Math.floor(maxChars / 2));
	return `${head} … ${tail}`;
}

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

function summarizeCurrentBranch(ctx: any): string {
	const branch = ctx.sessionManager.getBranch();
	const lines: string[] = [];
	for (const entry of branch.slice(-10)) {
		if (entry.type !== "message") continue;
		const role = entry.message.role;
		if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;
		const text = messageText(entry.message);
		if (!text) continue;
		lines.push(`${role}: ${text}`);
	}
	return makeSnippet(lines.join("\n"), 1000);
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

async function loadConfigFromSession(ctx: any): Promise<void> {
	config = { ...DEFAULT_CONFIG };
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === STATE_TYPE) {
			config = { ...config, ...(entry.data as Partial<RouterConfig>) };
		}
	}
}

function setRouterStatus(ctx: any): void {
	if (!ctx.hasUI) return;
	const state = config.enabled
		? `🧭 router on (${config.confidenceThreshold.toFixed(2)})`
		: "🧭 router off";
	ctx.ui.setStatus("session-router", state);
}

function notifyRoutingDecision(ctx: any, message: string, level: "info" | "warning" = "info"): void {
	if (!config.showRoutingNotices || !ctx.hasUI) return;
	ctx.ui.notify(message, level);
}

function buildCandidates(
	sessions: SessionInfo[],
	currentSessionFile: string | undefined,
	prompt: string,
	cache: SessionSummaryCache,
): Candidate[] {
	const promptTokens = tokenize(prompt);
	const recent = [...sessions]
		.sort((a, b) => b.modified.getTime() - a.modified.getTime())
		.slice(0, MAX_RECENT_SESSIONS);

	const ranked = recent
		.map((info) => ({
			info,
			score: scoreSession(promptTokens, info, cache[info.path]?.summary),
		}))
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return b.info.modified.getTime() - a.info.modified.getTime();
		})
		.slice(0, MAX_LLM_CANDIDATES)
		.map(({ info, score }, idx) => ({
			key: `S${idx + 1}`,
			path: info.path,
			name: info.name,
			modified: info.modified.toISOString(),
			firstMessage: info.firstMessage,
			snippet: makeSnippet(cache[info.path]?.summary ?? info.allMessagesText),
			current: currentSessionFile === info.path,
			score,
		}));

	return ranked;
}

function buildPromptContent(payload: RoutedPromptPayload): string | Array<{ type: "text" } | Record<string, unknown>> {
	if (payload.images && payload.images.length > 0) {
		return [{ type: "text", text: payload.text } as any, ...payload.images];
	}
	return payload.text;
}

function isLikelyContinuation(prompt: string, currentCandidate: Candidate | undefined): boolean {
	if (!currentCandidate) return false;
	const lower = prompt.trim().toLowerCase();
	const continuationPrefixes = [
		"continue",
		"also",
		"now",
		"next",
		"fix that",
		"do that",
		"go ahead",
		"and ",
		"what about",
		"can you also",
	];
	const looksLikeContinuation = continuationPrefixes.some((prefix) => lower.startsWith(prefix));
	const recentlyActive = Date.now() - new Date(currentCandidate.modified).getTime() < CONTINUATION_WINDOW_MS;
	return looksLikeContinuation || (recentlyActive && currentCandidate.score >= 2);
}

async function selectRoutingModel(ctx: any): Promise<Model<any> | null> {
	const free = ctx.modelRegistry.find?.("openrouter", "openrouter/free");
	if (free) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(free);
		if (auth.ok && auth.apiKey) return free;
	}
	if (ctx.model) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok && auth.apiKey) return ctx.model;
	}
	return null;
}

async function routePrompt(payload: RoutedPromptPayload, ctx: any): Promise<RouterDecision | null> {
	const currentSessionFile = ctx.sessionManager.getSessionFile();
	const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
	if (sessions.length === 0) return null;

	const cache = await readSummaryCache();
	const candidates = buildCandidates(sessions, currentSessionFile, payload.text, cache);
	if (candidates.length === 0) return null;

	const promptTokens = tokenize(payload.text);
	const topScore = candidates[0]?.score ?? 0;
	if (promptTokens.length >= 3 && topScore <= 1) {
		return {
			choice: "NEW",
			confidence: 0.99,
			reason: "Prompt has almost no overlap with any recent local session, so it should start a new session.",
		};
	}

	const currentCandidate = candidates.find((c) => c.current);
	if (isLikelyContinuation(payload.text, currentCandidate)) {
		return { choice: "CURRENT", confidence: 0.98, reason: "Prompt looks like a continuation of the current session." };
	}

	const routingModel = await selectRoutingModel(ctx);
	if (!routingModel) return null;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(routingModel);
	if (!auth.ok || !auth.apiKey) return null;

	const systemPrompt = [
		"You are a session router for a coding agent.",
		"Choose the SINGLE best destination for this new prompt: CURRENT, NEW, or one of the candidate sessions.",
		"Only switch if one session is clearly more relevant than the current session.",
		"Choose NEW if the prompt starts a distinct new topic and no existing session is clearly a fit.",
		"Prefer CURRENT for follow-up or continuation prompts.",
		"Return strict JSON only in the form: {\"choice\":\"CURRENT|NEW|S1|S2|...\",\"confidence\":0.0,\"reason\":\"...\"}",
	].join(" ");

	const userMessage: Message = {
		role: "user",
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						prompt: payload.text,
						currentSessionFile,
						candidates,
						confidenceThreshold: config.confidenceThreshold,
					},
					null,
					2,
				),
			},
		],
		timestamp: Date.now(),
	};

	const response = await complete(
		routingModel,
		{ systemPrompt, messages: [userMessage] },
		{ apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
	);
	if (response.stopReason === "aborted") return null;

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	const parse = (raw: string): RouterDecision | null => {
		try {
			const obj = JSON.parse(raw) as Partial<RouterDecision>;
			if (typeof obj.choice !== "string") return null;
			return {
				choice: obj.choice,
				confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
				reason: typeof obj.reason === "string" ? obj.reason : "",
			};
		} catch {
			return null;
		}
	};

	return parse(text) ?? (text.match(/\{[\s\S]*\}/)?.[0] ? parse(text.match(/\{[\s\S]*\}/)![0]) : null);
}

export default function (pi: ExtensionAPI) {
	installAgentSessionCapture();

	pi.on("session_start", async (_event, ctx) => {
		await loadConfigFromSession(ctx);
		setRouterStatus(ctx);
		await updateCurrentSessionSummary(ctx).catch(() => {});
	});

	pi.on("agent_end", async (_event, ctx) => {
		await updateCurrentSessionSummary(ctx).catch(() => {});
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		if (!config.enabled) return { action: "continue" };
		if (event.text.trim().startsWith("/")) return { action: "continue" };
		if (!activeAgentSession || typeof (activeAgentSession as any).createReplacedSessionContext !== "function") {
			return { action: "continue" };
		}

		const payload: RoutedPromptPayload = {
			text: event.text,
			images: event.images as Array<Record<string, unknown>> | undefined,
		};
		const decision = await routePrompt(payload, ctx);
		const content = buildPromptContent(payload) as any;

		if (!decision) {
			notifyRoutingDecision(ctx, "Session router: no routing decision, continuing here.");
			return { action: "continue" };
		}

		if (decision.choice === "CURRENT") {
			notifyRoutingDecision(ctx, `Session router: staying in current session (${Math.round(decision.confidence * 100)}%) — ${decision.reason}`);
			return { action: "continue" };
		}

		if (decision.confidence < config.confidenceThreshold) {
			notifyRoutingDecision(
				ctx,
				`Session router: low confidence (${Math.round(decision.confidence * 100)}% < ${Math.round(config.confidenceThreshold * 100)}%), staying here — ${decision.reason}`,
				"warning",
			);
			return { action: "continue" };
		}

		const commandCtx = (activeAgentSession as any).createReplacedSessionContext();

		if (decision.choice === "NEW" && config.createNewSession) {
			notifyRoutingDecision(ctx, `Session router: starting new session (${Math.round(decision.confidence * 100)}%) — ${decision.reason}`);
			const parentSession = ctx.sessionManager.getSessionFile();
			const result = await commandCtx.newSession({
				parentSession,
				withSession: async (replacementCtx: any) => {
					if (replacementCtx.hasUI && config.showRoutingNotices) {
						replacementCtx.ui.notify(`Started new session: ${decision.reason}`, "info");
					}
					await replacementCtx.sendUserMessage(content);
				},
			});
			if (result.cancelled) {
				ctx.ui.notify("Session router: new session cancelled, continuing here.", "warning");
				return { action: "continue" };
			}
			return { action: "handled" };
		}

		const sessions = await SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
		const cache = await readSummaryCache();
		const candidates = buildCandidates(sessions, ctx.sessionManager.getSessionFile(), payload.text, cache);
		const match = candidates.find((c) => c.key === decision.choice);
		if (!match || match.current) {
			return { action: "continue" };
		}

		notifyRoutingDecision(
			ctx,
			`Session router: switching to ${match.name ?? match.firstMessage.slice(0, 60)} (${Math.round(decision.confidence * 100)}%) — ${decision.reason}`,
		);
		const result = await commandCtx.switchSession(match.path, {
			withSession: async (replacementCtx: any) => {
				if (replacementCtx.hasUI && config.showRoutingNotices) {
					replacementCtx.ui.notify(
						`Switched to relevant session: ${match.name ?? match.firstMessage.slice(0, 60)} (${Math.round(decision.confidence * 100)}%)`,
						"info",
					);
				}
				await replacementCtx.sendUserMessage(content);
			},
		});

		if (result.cancelled) {
			ctx.ui.notify("Session router: switch cancelled, continuing in current session.", "warning");
			return { action: "continue" };
		}

		return { action: "handled" };
	});

	pi.registerCommand("session-router", {
		description: "Control session router: on, off, toggle, status, threshold <0-1>, notices on|off",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [actionRaw, valueRaw] = trimmed.split(/\s+/, 2);
			const action = (actionRaw ?? "").toLowerCase();
			if (action === "" || action === "status") {
				ctx.ui.notify(
					`Session router is ${config.enabled ? "ON" : "OFF"}. Threshold=${config.confidenceThreshold.toFixed(2)}. New-session=${config.createNewSession ? "on" : "off"}. Notices=${config.showRoutingNotices ? "on" : "off"}.`,
					"info",
				);
				setRouterStatus(ctx);
				return;
			}

			if (action === "on") config.enabled = true;
			else if (action === "off") config.enabled = false;
			else if (action === "toggle") config.enabled = !config.enabled;
			else if (action === "threshold") {
				const parsed = Number(valueRaw);
				if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
					ctx.ui.notify("Usage: /session-router threshold <number between 0 and 1>", "error");
					return;
				}
				config.confidenceThreshold = parsed;
			} else if (action === "notices") {
				const value = (valueRaw ?? "").toLowerCase();
				if (value !== "on" && value !== "off") {
					ctx.ui.notify("Usage: /session-router notices <on|off>", "error");
					return;
				}
				config.showRoutingNotices = value === "on";
			} else {
				ctx.ui.notify("Usage: /session-router [on|off|toggle|status|threshold <0-1>|notices <on|off>]", "error");
				return;
			}

			pi.appendEntry(STATE_TYPE, config);
			setRouterStatus(ctx);
			ctx.ui.notify(
				`Session router updated. Enabled=${config.enabled ? "on" : "off"}, threshold=${config.confidenceThreshold.toFixed(2)}, notices=${config.showRoutingNotices ? "on" : "off"}.`,
				"success",
			);
		},
	});
}
