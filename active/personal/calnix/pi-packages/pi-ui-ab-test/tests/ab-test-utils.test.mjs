import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildChoiceEntry,
	describePreviewImageSelection,
	getImageMimeType,
	loadImagePreview,
	normalizeRationaleInput,
	resolveArtifactPaths,
	summarizeVariant,
} from "../extensions/ab-test-utils.mjs";

test("getImageMimeType detects supported preview extensions", () => {
	assert.equal(getImageMimeType("preview.png"), "image/png");
	assert.equal(getImageMimeType("preview.JPG"), "image/jpeg");
	assert.equal(getImageMimeType("preview.webp"), "image/webp");
	assert.equal(getImageMimeType("preview.svg"), null);
});

test("resolveArtifactPaths normalizes relative and absolute artifact paths", () => {
	const cwd = "/tmp/demo";
	assert.deepEqual(resolveArtifactPaths(["a.png", "/abs/b.png", "a.png"], cwd), ["/tmp/demo/a.png", "/abs/b.png"]);
});

test("summarizeVariant includes artifacts and preview images", () => {
	const text = summarizeVariant({
		summary: "Minimal card layout",
		artifactPaths: ["/tmp/a.html"],
		imagePaths: ["/tmp/a.png"],
	});
	assert.match(text, /Minimal card layout/);
	assert.match(text, /Artifacts: \/tmp\/a.html/);
	assert.match(text, /Preview images: \/tmp\/a.png/);
});

test("describePreviewImageSelection includes filename and position", () => {
	const text = describePreviewImageSelection(
		{
			images: [
				{ name: "cat.png", path: "/tmp/cat.png" },
				{ name: "cat-alt.png", path: "/tmp/cat-alt.png" },
			],
		},
		1,
	);
	assert.match(text, /cat-alt\.png/);
	assert.match(text, /2\/2/);
});


test("loadImagePreview reads supported images as base64", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-ui-ab-test-"));
	const imagePath = join(dir, "preview.png");
	await writeFile(imagePath, Buffer.from("hello world"));
	const preview = await loadImagePreview(imagePath, dir);
	assert.equal(preview.path, imagePath);
	assert.equal(preview.mimeType, "image/png");
	assert.equal(Buffer.from(preview.data, "base64").toString("utf8"), "hello world");
});

test("normalizeRationaleInput trims content and drops blank values", () => {
	assert.equal(normalizeRationaleInput("  clearer hierarchy  "), "clearer hierarchy");
	assert.equal(normalizeRationaleInput("   \n\t  "), null);
	assert.equal(normalizeRationaleInput(undefined), null);
});

test("buildChoiceEntry persists normalized rationale with the selected variant metadata", () => {
	const entry = buildChoiceEntry({
		title: "Hero direction",
		choice: "B",
		selected: {
			label: "Bold gradient",
			summary: "Higher contrast hero with stronger CTA emphasis.",
			artifactPaths: ["/tmp/hero.html"],
			imagePaths: ["/tmp/hero-b.png"],
		},
		rationale: "  clearer CTA hierarchy  ",
		timestamp: "2026-05-05T00:00:00.000Z",
	});
	assert.deepEqual(entry, {
		title: "Hero direction",
		choice: "B",
		label: "Bold gradient",
		summary: "Higher contrast hero with stronger CTA emphasis.",
		artifactPaths: ["/tmp/hero.html"],
		imagePaths: ["/tmp/hero-b.png"],
		rationale: "clearer CTA hierarchy",
		timestamp: "2026-05-05T00:00:00.000Z",
	});
});
