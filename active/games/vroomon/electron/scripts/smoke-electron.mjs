#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const appDirectory = process.cwd();
const sandboxDirectory = mkdtempSync(join(tmpdir(), "vroomon-electron-smoke-"));
const tmpDirectory = join(sandboxDirectory, "tmp");
const runtimeDirectory = join(sandboxDirectory, "runtime");

mkdirSync(tmpDirectory, { recursive: true });
mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });

function hasCommand(command) {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

function isNixOS() {
  if (!existsSync("/etc/os-release")) {
    return false;
  }

  return /^ID=nixos$/im.test(readFileSync("/etc/os-release", "utf8"));
}

function buildLaunchCommand() {
  if (isNixOS()) {
    return {
      command: "nix",
      args: [
        "--extra-experimental-features",
        "nix-command flakes",
        "shell",
        "nixpkgs#electron",
        "-c",
        "electron",
        ".",
      ],
    };
  }

  return {
    command:
      process.platform === "win32"
        ? join(appDirectory, "node_modules", ".bin", "electron.cmd")
        : join(appDirectory, "node_modules", ".bin", "electron"),
    args: ["."],
  };
}

const env = {
  ...process.env,
  TMPDIR: tmpDirectory,
  XDG_RUNTIME_DIR: runtimeDirectory,
  VROOMON_DISABLE_HARDWARE_ACCELERATION:
    process.env.VROOMON_DISABLE_HARDWARE_ACCELERATION ?? "1",
  VROOMON_DISABLE_SANDBOX: process.env.VROOMON_DISABLE_SANDBOX ?? "1",
  VROOMON_DISABLE_DEV_SHM_USAGE: process.env.VROOMON_DISABLE_DEV_SHM_USAGE ?? "1",
  VROOMON_SMOKE_TEST: "1",
};

if (env.DISPLAY) {
  delete env.WAYLAND_DISPLAY;
  env.XDG_SESSION_TYPE = "x11";
  env.ELECTRON_OZONE_PLATFORM_HINT = "x11";
}

const launch = buildLaunchCommand();
const needsXvfb =
  process.platform === "linux" &&
  !env.DISPLAY &&
  hasCommand("xvfb-run");
const command = needsXvfb ? "xvfb-run" : launch.command;
const args = needsXvfb ? ["-a", launch.command, ...launch.args] : launch.args;

const child = spawn(command, args, {
  cwd: appDirectory,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  stderr += text;
  process.stderr.write(text);
});

function cleanup() {
  rmSync(sandboxDirectory, { recursive: true, force: true });
}

child.on("error", (error) => {
  cleanup();
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  cleanup();

  const successLine = stdout
    .trim()
    .split("\n")
    .find((line) => line.startsWith("VROOMON_SMOKE_SUCCESS "));

  if (signal) {
    console.error(`Electron smoke test terminated by signal ${signal}.`);
    process.exit(1);
  }

  if (!successLine) {
    console.error("Electron smoke test did not report a successful renderer load.");
    process.exit(code ?? 1);
  }

  const payload = JSON.parse(successLine.slice("VROOMON_SMOKE_SUCCESS ".length));

  if (
    !payload ||
    payload.hasVroomon !== true ||
    typeof payload.statusMessage !== "string" ||
    payload.statusMessage.length === 0 ||
    !Array.isArray(payload.activePanels) ||
    payload.activePanels.length !== 1
  ) {
    console.error("Electron smoke test reported incomplete renderer diagnostics.");
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  process.exit(code ?? 0);
});
