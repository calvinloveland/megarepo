const MAX_RECENT_SESSIONS = 20;
const MAX_LLM_CANDIDATES = 8;
const MAX_SNIPPET_CHARS = 700;

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
	"prompt",
	"project",
	"really",
	"same",
	"session",
	"sessions",
	"should",
	"still",
	"system",
	"test",
	"time",
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
	"tool",
	"tools",
	"turn",
	"update",
	"use",
	"uses",
	"using",
	"want",
	"when",
	"with",
	"work",
	"would",
	"your",
]);

export { MAX_LLM_CANDIDATES, MAX_RECENT_SESSIONS, MAX_SNIPPET_CHARS };

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
	return new Set(
		unique(tokenize(`${info.name ?? ""}\n${info.firstMessage}\n${cachedSummary ?? ""}\n${info.allMessagesText}`)),
	);
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
		.slice(0, MAX_LLM_CANDIDATES)
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

export function isLikelyContinuation(prompt) {
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
		"please continue",
		"retry",
		"try again",
	];
	return continuationPrefixes.some((prefix) => lower.startsWith(prefix));
}

export function getHeuristicDecision(prompt, candidates) {
	const promptTokens = unique(tokenize(prompt));
	if (promptTokens.length === 0) return null;

	if (isLikelyContinuation(prompt)) {
		return {
			choice: "CURRENT",
			confidence: 0.98,
			reason: "Prompt uses explicit continuation language, so it likely belongs in the current session.",
		};
	}

	const topScore = candidates[0]?.score ?? 0;
	if (promptTokens.length >= 3 && topScore === 0) {
		return {
			choice: "NEW",
			confidence: 0.99,
			reason: "Prompt has no meaningful token overlap with any recent local session, so it should start a new session.",
		};
	}

	return null;
}
