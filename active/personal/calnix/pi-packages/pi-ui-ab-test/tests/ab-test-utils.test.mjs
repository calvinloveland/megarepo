import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getImageMimeType, loadImagePreview, resolveArtifactPaths, summarizeVariant } from "../extensions/ab-test-utils.mjs";

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

test("loadImagePreview reads supported images as base64", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-ui-ab-test-"));
	const imagePath = join(dir, "preview.png");
	await writeFile(imagePath, Buffer.from("hello world"));
	const preview = await loadImagePreview(imagePath, dir);
	assert.equal(preview.path, imagePath);
	assert.equal(preview.mimeType, "image/png");
	assert.equal(Buffer.from(preview.data, "base64").toString("utf8"), "hello world");
});
