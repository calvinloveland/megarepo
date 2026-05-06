import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME_CANDIDATES = [
  "/run/current-system/sw/bin/google-chrome",
  "/run/current-system/sw/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function normalizeUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    throw new Error("A URL is required.");
  }
  if (value.startsWith("//")) {
    return `http:${value}`;
  }
  if (value.startsWith("localhost") || value.startsWith("127.0.0.1") || value.startsWith("0.0.0.0")) {
    return `http://${value}`;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    return value;
  }
  return `https://${value}`;
}

export function chooseChromeExecutable(candidates = CHROME_CANDIDATES) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "xdg-open";
}

export function launchWebpage(rawUrl, { newWindow = false } = {}) {
  const url = normalizeUrl(rawUrl);
  const executable = chooseChromeExecutable();
  const args = executable.endsWith("xdg-open")
    ? [url]
    : [newWindow ? "--new-window" : "--new-tab", url];

  const proc = spawn(executable, args, {
    detached: true,
    stdio: "ignore",
  });
  proc.unref();

  return {
    url,
    executable,
    args,
    pid: proc.pid,
  };
}
