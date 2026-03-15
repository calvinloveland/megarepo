#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const appDirectory = process.cwd();
const playwrightCli = join(
  appDirectory,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);

function isNixOS() {
  if (!existsSync("/etc/os-release")) {
    return false;
  }

  return /^ID=nixos$/im.test(readFileSync("/etc/os-release", "utf8"));
}

function hasCommand(command) {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

function resolveBrowserExecutable() {
  if (process.env.VROOMON_BROWSER_EXECUTABLE) {
    return process.env.VROOMON_BROWSER_EXECUTABLE;
  }

  if (isNixOS()) {
    const output = spawnSync(
      "nix",
      [
        "--extra-experimental-features",
        "nix-command flakes",
        "build",
        "--no-link",
        "--print-out-paths",
        "nixpkgs#chromium",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );

    if (output.status !== 0) {
      process.exit(output.status ?? 1);
    }

    const packagePath = output.stdout
      .trim()
      .split("\n")
      .findLast((line) => line.length > 0);

    if (!packagePath) {
      throw new Error("Could not resolve nixpkgs Chromium package path.");
    }

    return join(packagePath, "bin", "chromium");
  }

  return undefined;
}

const sandboxDirectory = mkdtempSync(join(tmpdir(), "vroomon-playwright-"));
const tmpDirectory = join(sandboxDirectory, "tmp");
const runtimeDirectory = join(sandboxDirectory, "runtime");

mkdirSync(tmpDirectory, { recursive: true });
mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });

const browserExecutable = resolveBrowserExecutable();

const env = {
  ...process.env,
  TMPDIR: process.env.TMPDIR ?? tmpDirectory,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? runtimeDirectory,
  VROOMON_DISABLE_HARDWARE_ACCELERATION:
    process.env.VROOMON_DISABLE_HARDWARE_ACCELERATION ?? "1",
  VROOMON_DISABLE_SANDBOX: process.env.VROOMON_DISABLE_SANDBOX ?? "1",
  VROOMON_DISABLE_DEV_SHM_USAGE: process.env.VROOMON_DISABLE_DEV_SHM_USAGE ?? "1",
  ...(browserExecutable
    ? { VROOMON_BROWSER_EXECUTABLE: browserExecutable }
    : {}),
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
} ;

const staticServer = createServer(async (request, response) => {
  const requestPath = request.url ? new URL(request.url, "http://127.0.0.1").pathname : "/";
  const normalizedPath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = resolve(appDirectory, `.${normalizedPath}`);

  if (!filePath.startsWith(appDirectory)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const file = await import("node:fs/promises").then(({ readFile }) => readFile(filePath));
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    });
    response.end(file);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

const port = await new Promise((resolvePort, reject) => {
  staticServer.once("error", reject);
  staticServer.listen(0, "127.0.0.1", () => {
    const address = staticServer.address();
    if (!address || typeof address === "string") {
      reject(new Error("Could not determine static server address."));
      return;
    }
    resolvePort(address.port);
  });
});

env.VROOMON_E2E_BASE_URL = `http://127.0.0.1:${port}`;

const command = playwrightCli;
const args = ["test", ...process.argv.slice(2)];
const needsXvfb = process.platform === "linux" && !process.env.DISPLAY && hasCommand("xvfb-run");
const wrappedCommand = needsXvfb ? "xvfb-run" : command;
const wrappedArgs = needsXvfb ? ["-a", command, ...args] : args;

const child = spawn(wrappedCommand, wrappedArgs, {
  cwd: appDirectory,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  staticServer.close();
  rmSync(sandboxDirectory, { recursive: true, force: true });

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  staticServer.close();
  rmSync(sandboxDirectory, { recursive: true, force: true });
  console.error(error.message);
  process.exit(1);
});
