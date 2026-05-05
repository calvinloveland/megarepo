import test from "node:test";
import assert from "node:assert/strict";

import { buildChoiceEntry } from "../extensions/ab-test-utils.mjs";

test("buildChoiceEntry stores null rationale when the user skips the follow-up input", () => {
	const entry = buildChoiceEntry({
		title: "Card layout review",
		choice: "A",
		selected: {
			label: "Minimal cards",
			summary: "Cleaner spacing and calmer hierarchy.",
			artifactPaths: ["/tmp/cards.html"],
			imagePaths: ["/tmp/cards-a.png"],
		},
		rationale: "   ",
		timestamp: "2026-05-05T00:00:00.000Z",
	});

	assert.equal(entry.rationale, null);
	assert.equal(entry.choice, "A");
	assert.equal(entry.label, "Minimal cards");
});
