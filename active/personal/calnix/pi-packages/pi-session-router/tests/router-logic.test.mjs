import test from "node:test";
import assert from "node:assert/strict";

import { buildCandidates, getHeuristicDecision, tokenize } from "../extensions/router-logic.mjs";

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

test("tokenize removes generic stopwords that caused false overlap", () => {
	assert.deepEqual(tokenize("This is a test prompt about the session router system"), ["router"]);
});

test("explicit continuation language stays in the current session", () => {
	const sessions = [
		makeSession(
			"/sessions/router.jsonl",
			"router work",
			"Investigate the session router",
			"We are debugging the pi session router and adjusting confidence thresholds.",
		),
	];
	const candidates = buildCandidates(sessions, "/sessions/router.jsonl", "Can you also tighten the threshold logic?", {});
	const decision = getHeuristicDecision("Can you also tighten the threshold logic?", candidates);
	assert.equal(decision?.choice, "CURRENT");
	assert.equal(decision?.confidence, 0.98);
});

test("unrelated prompt starts a new session instead of reporting false 98 percent similarity", () => {
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
	const prompt = "My openclaw install needs to be updated to use mountain time instead of utc time it currently uses.";
	const candidates = buildCandidates(sessions, "/sessions/router.jsonl", prompt, {});
	const decision = getHeuristicDecision(prompt, candidates);
	assert.equal(candidates[0]?.score ?? 0, 0);
	assert.equal(decision?.choice, "NEW");
	assert.equal(decision?.confidence, 0.99);
});

test("topic-specific prompt ranks the matching session ahead of unrelated sessions", () => {
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
	const prompt = "Please fix the openclaw timezone so it uses mountain time.";
	const candidates = buildCandidates(sessions, "/sessions/router.jsonl", prompt, {});
	assert.equal(candidates[0]?.path, "/sessions/openclaw.jsonl");
	assert.ok((candidates[0]?.score ?? 0) > (candidates[1]?.score ?? 0));
	assert.deepEqual(candidates[0]?.sharedTokens, ["openclaw", "timezone"]);
});
