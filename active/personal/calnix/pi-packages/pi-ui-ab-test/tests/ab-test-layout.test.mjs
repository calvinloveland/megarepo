import test from "node:test";
import assert from "node:assert/strict";

import { buildVariantPanelLines, joinPanelColumns } from "../extensions/ab-test-layout.mjs";

test("buildVariantPanelLines includes explicit selection instructions and counts", () => {
	const lines = buildVariantPanelLines(
		{
			key: "A",
			label: "Minimal cards",
			summary: "A cleaner layout with more breathing room around the hero image and buttons.",
			artifactPaths: ["/tmp/a.html", "/tmp/a.css"],
			imagePaths: ["/tmp/a.png"],
		},
		{ columnWidth: 42, active: true, shortcut: "1 / A" },
	);

	assert.match(lines.join("\n"), /Enter chooses this • Press 1 \/ A/);
	assert.match(lines.join("\n"), /2 artifact\(s\) • 1 preview\(s\)/);
	assert.match(lines.join("\n"), /A — Minimal cards/);
});

test("joinPanelColumns places both variants on the same rows", () => {
	const left = buildVariantPanelLines(
		{ key: "A", label: "Option A", summary: "Left summary", artifactPaths: [], imagePaths: [] },
		{ columnWidth: 30, active: true, shortcut: "1 / A" },
	);
	const right = buildVariantPanelLines(
		{ key: "B", label: "Option B", summary: "Right summary", artifactPaths: [], imagePaths: [] },
		{ columnWidth: 30, active: false, shortcut: "2 / B" },
	);

	const joined = joinPanelColumns(left, right, { columnWidth: 30, gap: 3 });
	assert.ok(joined.some((line) => line.includes("Option A") && line.includes("Option B")));
	assert.equal(joined.length, Math.max(left.length, right.length));
});
