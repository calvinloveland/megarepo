import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(__dirname, "..", "extensions", "session-router.ts");

test("session replacement flows avoid stale pre-replacement ctx notifications", async () => {
	const source = await readFile(extensionPath, "utf8");

	assert.doesNotMatch(source, /Session switch cancelled\./);
	assert.doesNotMatch(source, /Handoff cancelled\./);
	assert.match(source, /await ctx\.switchSession\(/);
	assert.match(source, /await ctx\.newSession\(/);
});
