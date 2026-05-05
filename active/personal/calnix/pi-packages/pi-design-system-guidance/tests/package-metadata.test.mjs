import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf-8"));
}

test("package metadata declares a prompt-only Pi package", async () => {
  const pkg = await readJson(join(packageRoot, "package.json"));

  assert.equal(pkg.name, "pi-design-system-guidance");
  assert.match(pkg.description, /Prompt-only Pi package/i);
  assert.deepEqual(pkg.pi.prompts, ["./prompts"]);
  assert.equal("extensions" in pkg.pi, false);
  assert.equal("skills" in pkg.pi, false);
  assert.equal("themes" in pkg.pi, false);
  assert.deepEqual(pkg.files, ["prompts", "README.md", "LICENSE"]);
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.ok(pkg.keywords.includes("design-system"));
});

test("prompt and README describe reusable UI guidance", async () => {
  const prompt = await readFile(join(packageRoot, "prompts", "design-system-guidance.md"), "utf-8");
  const readme = await readFile(join(packageRoot, "README.md"), "utf-8");

  assert.match(prompt, /^---\ndescription: Apply reusable design-system guidance to a Pi UI task/m);
  assert.match(prompt, /shared UI primitives/i);
  assert.match(prompt, /default, hover, focus, active, disabled, loading, empty, error, and success/i);
  assert.match(prompt, /ab_test_visuals/);
  assert.match(readme, /\/design-system-guidance/);
  assert.match(readme, /pi install \.\/pi-packages\/pi-design-system-guidance/);
});
