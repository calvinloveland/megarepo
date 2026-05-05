import test from "node:test";
import assert from "node:assert/strict";

import { buildCandidates, buildHandoffPrompt, chooseBestCandidate, formatTokenCount, tokenize } from "../extensions/router-logic.mjs";

function makeSession(path, name, firstMessage, allMessagesText, modified = "2026-04-30T12:00:00.000Z") {
	return {
		path,
		id: path,
		cwd: "/tmp/project",
		name,
		created: new Date(modified),
		modified: new Date(modified),
		messageCount: 4,
		firstMessage,
		allMessagesText,
	};
}

test("tokenize removes generic search terms and stopwords", () => {
	assert.deepEqual(tokenize("Please find the best session for the router system"), ["router"]);
});

test("topic-specific search ranks the matching session ahead of unrelated sessions", () => {
	const sessions = [
		makeSession(
			"/sessions/router.jsonl",
			"router work",
			"Investigate the session router",
			"We are debugging the pi session router and adjusting confidence thresholds.",
			"2026-04-30T12:00:00.000Z",
		),
		makeSession(
			"/sessions/openclaw.jsonl",
			"openclaw deploy",
			"Fix the OpenClaw deployment timezone",
			"Update the OpenClaw Kubernetes deployment to use America/Denver instead of UTC and redeploy it.",
			"2026-04-29T12:00:00.000Z",
		),
	];
	const candidates = buildCandidates(sessions, "/sessions/router.jsonl", "openclaw timezone mountain time", {});
	assert.equal(candidates[0]?.path, "/sessions/openclaw.jsonl");
	assert.ok((candidates[0]?.score ?? 0) > (candidates[1]?.score ?? 0));
	assert.deepEqual(candidates[0]?.sharedTokens, ["openclaw", "timezone"]);
});

test("chooseBestCandidate returns null when nothing meaningfully matches", () => {
	const sessions = [
		makeSession(
			"/sessions/router.jsonl",
			"router work",
			"Investigate the session router",
			"We are debugging the pi session router and adjusting confidence thresholds.",
		),
		makeSession(
			"/sessions/nix.jsonl",
			"nix config",
			"Update a NixOS module",
			"This session changes host modules, home-manager config, and flake validation.",
			"2026-04-29T12:00:00.000Z",
		),
	];
	const candidates = buildCandidates(sessions, "/sessions/router.jsonl", "mountain time utc offset for openclaw", {});
	assert.equal(chooseBestCandidate(candidates), null);
});

test("chooseBestCandidate prefers another session when current session only ties on score", () => {
	const sessions = [
		makeSession(
			"/sessions/current.jsonl",
			"current work",
			"OpenClaw timezone debug",
			"Notes about openclaw timezone handling.",
			"2026-04-30T12:00:00.000Z",
		),
		makeSession(
			"/sessions/older.jsonl",
			"older openclaw work",
			"OpenClaw timezone deploy",
			"Deployment changes for openclaw timezone and clocks.",
			"2026-04-29T12:00:00.000Z",
		),
	];
	const candidates = buildCandidates(sessions, "/sessions/current.jsonl", "openclaw timezone", {});
	const best = chooseBestCandidate(candidates, { preferNonCurrentOnTie: true });
	assert.equal(best?.path, "/sessions/older.jsonl");
});

test("buildHandoffPrompt keeps the new-session prompt compact and actionable", () => {
	const prompt = buildHandoffPrompt({
		sessionLabel: "router work",
		summary: "We replaced automatic routing with explicit local search to avoid oversized routing prompts.",
		recentMessages: "user: the last session hit 413\nassistant: switch to a fresh session with a compact handoff",
		goal: "Finish the 413 fix and verify the tests.",
	});
	assert.match(prompt, /## Context/);
	assert.match(prompt, /Continue from: router work/);
	assert.match(prompt, /## Task/);
	assert.match(prompt, /Finish the 413 fix and verify the tests/);
	assert.match(prompt, /Treat this prompt as the handoff source of truth/);
});

test("formatTokenCount keeps session-size warnings readable", () => {
	assert.equal(formatTokenCount(950), "950");
	assert.equal(formatTokenCount(12_300), "12k");
	assert.equal(formatTokenCount(185_000), "185k");
});
