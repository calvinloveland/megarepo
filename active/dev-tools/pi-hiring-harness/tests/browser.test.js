import test from "node:test";
import assert from "node:assert/strict";
import { chooseChromeExecutable, normalizeUrl } from "../lib/browser.js";

test("normalizeUrl keeps explicit schemes", () => {
  assert.equal(normalizeUrl("http://127.0.0.1:51873/hiring-demo.html"), "http://127.0.0.1:51873/hiring-demo.html");
  assert.equal(normalizeUrl("https://example.com"), "https://example.com");
});

test("normalizeUrl adds http for localhost-like hosts", () => {
  assert.equal(normalizeUrl("127.0.0.1:51873/hiring-demo.html"), "http://127.0.0.1:51873/hiring-demo.html");
  assert.equal(normalizeUrl("localhost:3000"), "http://localhost:3000");
});

test("normalizeUrl adds https for plain domains", () => {
  assert.equal(normalizeUrl("example.com/demo"), "https://example.com/demo");
});

test("chooseChromeExecutable returns first existing candidate or xdg-open", () => {
  assert.equal(chooseChromeExecutable(["/definitely/missing", "/also/missing"]), "xdg-open");
});
