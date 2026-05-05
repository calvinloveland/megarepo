const MAX_RECENT_SESSIONS = 20;
const MAX_SEARCH_CANDIDATES = 8;
const MAX_SNIPPET_CHARS = 700;
const MAX_HANDOFF_SUMMARY_CHARS = 1200;
const MAX_HANDOFF_RECENT_CHARS = 700;
const SESSION_WARNING_TOKENS = 100_000;
const SESSION_CRITICAL_TOKENS = 140_000;
const SESSION_WARNING_PERCENT = 70;
const SESSION_CRITICAL_PERCENT = 85;

const STOPWORDS = new Set([
	"about",
	"after",
	"again",
	"agent",
	"all",
	"also",
	"and",
	"any",
	"are",
	"around",
	"because",
	"best",
	"been",
	"before",
	"being",
	"between",
	"both",
	"build",
	"but",
	"can",
	"code",
	"current",
	"does",
	"ever",
	"file",
	"files",
	"find",
	"fix",
	"for",
	"from",
	"have",
	"here",
	"into",
	"just",
	"like",
	"make",
	"need",
	"needs",
	"never",
	"not",
	"now",
	"other",
	"our",
	"out",
	"over",
	"please",
	"problem",
	"project",
	"really",
	"same",
	"search",
	"session",
	"sessions",
	"should",
	"still",
	"switch",
	"system",
	"test",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"through",
	"time",
	"topic",
	"use",
	"using",
	"want",
	"with",
	"work",
	"would",
	"your",
]);

export {
	MAX_HANDOFF_RECENT_CHARS,
	MAX_HANDOFF_SUMMARY_CHARS,
	MAX_SEARCH_CANDIDATES,
	MAX_RECENT_SESSIONS,
	MAX_SNIPPET_CHARS,
	SESSION_CRITICAL_PERCENT,
	SESSION_CRITICAL_TOKENS,
	SESSION_WARNING_PERCENT,
	SESSION_WARNING_TOKENS,
};

export function tokenize(text) {
	const raw = text.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? [];
	return raw.filter((token) => !STOPWORDS.has(token));
}

function unique(array) {
	return [...new Set(array)];
}

export function makeSnippet(text, maxChars = MAX_SNIPPET_CHARS) {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (cleaned.length <= maxChars) return cleaned;
	const head = cleaned.slice(0, Math.floor(maxChars / 2));
	const tail = cleaned.slice(-Math.floor(maxChars / 2));
	return `${head} … ${tail}`;
}

export function buildSessionTokenSet(info, cachedSummary) {
	return new Set(unique(tokenize(`${info.name ?? ""}\n${info.firstMessage}\n${cachedSummary ?? ""}\n${info.allMessagesText}`)));
}

export function scoreSession(promptTokens, info, cachedSummary) {
	const sessionTokens = buildSessionTokenSet(info, cachedSummary);
	const sharedTokens = unique(promptTokens.filter((token) => sessionTokens.has(token)));
	return {
		score: sharedTokens.length,
		sharedTokens,
	};
}

export function buildCandidates(sessions, currentSessionFile, prompt, cache) {
	const promptTokens = unique(tokenize(prompt));
	const recent = [...sessions]
		.sort((a, b) => b.modified.getTime() - a.modified.getTime())
		.slice(0, MAX_RECENT_SESSIONS);

	return recent
		.map((info) => {
			const { score, sharedTokens } = scoreSession(promptTokens, info, cache[info.path]?.summary);
			return { info, score, sharedTokens };
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return b.info.modified.getTime() - a.info.modified.getTime();
		})
		.slice(0, MAX_SEARCH_CANDIDATES)
		.map(({ info, score, sharedTokens }, idx) => ({
			key: `S${idx + 1}`,
			path: info.path,
			name: info.name,
			modified: info.modified.toISOString(),
			firstMessage: info.firstMessage,
			snippet: makeSnippet(cache[info.path]?.summary ?? info.allMessagesText),
			current: currentSessionFile === info.path,
			score,
			sharedTokens,
		}));
}

export function chooseBestCandidate(candidates, options = {}) {
	const { minScore = 1, preferNonCurrentOnTie = true } = options;
	const viable = candidates.filter((candidate) => (candidate.score ?? 0) >= minScore);
	if (viable.length === 0) return null;
	const top = viable[0];
	if (!top.current || !preferNonCurrentOnTie) return top;
	const tiedNonCurrent = viable.find((candidate) => !candidate.current && candidate.score === top.score);
	return tiedNonCurrent ?? top;
}

export function formatTokenCount(count = 0) {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 10_000) return `${Math.round(count / 1000)}k`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return `${count}`;
}

export function describeSessionHealth(usage = {}) {
	const tokens = Number(usage?.tokens ?? 0);
	const rawPercent = usage?.percent;
	const percent = Number.isFinite(rawPercent) ? Math.round(rawPercent) : null;
	const warning = tokens >= SESSION_WARNING_TOKENS || (percent !== null && percent >= SESSION_WARNING_PERCENT);
	if (!warning) return null;
	const critical = tokens >= SESSION_CRITICAL_TOKENS || (percent !== null && percent >= SESSION_CRITICAL_PERCENT);
	const summaryParts = [];
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

export function buildHandoffPrompt({ sessionLabel = "current session", summary = "", recentMessages = "", goal = "" } = {}) {
	const cleanedSummary = makeSnippet(summary, MAX_HANDOFF_SUMMARY_CHARS);
	const cleanedRecent = makeSnippet(recentMessages, MAX_HANDOFF_RECENT_CHARS);
	const cleanedGoal = goal.trim();
	const sections = [
		"## Context",
		`Continue from: ${sessionLabel}`,
	];

	if (cleanedSummary) {
		sections.push("", "Working summary:", cleanedSummary);
	}

	if (cleanedRecent && cleanedRecent !== cleanedSummary) {
		sections.push("", "Most recent exchange:", cleanedRecent);
	}

	sections.push(
		"",
		"## Task",
		cleanedGoal || "Continue the work in a fresh session.",
		"",
		"Treat this prompt as the handoff source of truth. Re-open files or rerun commands as needed instead of relying on the old session context.",
	);
	return sections.join("\n");
}
