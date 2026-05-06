import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function normalizeCwd(cwd, fallbackCwd) {
  return path.resolve(cwd ?? fallbackCwd ?? process.cwd());
}

export async function validateRequiredFiles(requiredFiles, cwd, fallbackCwd) {
  const resolvedCwd = normalizeCwd(cwd, fallbackCwd);
  const checks = [];

  for (const file of requiredFiles ?? []) {
    const resolvedPath = path.resolve(resolvedCwd, file);
    try {
      const stats = await fs.stat(resolvedPath);
      checks.push({
        path: file,
        resolvedPath,
        exists: stats.isFile() || stats.isDirectory(),
      });
    } catch {
      checks.push({
        path: file,
        resolvedPath,
        exists: false,
      });
    }
  }

  return checks;
}

export async function runValidationCommand(command, cwd, signal) {
  const resolvedCwd = normalizeCwd(cwd);
  const result = {
    command,
    cwd: resolvedCwd,
    exitCode: 0,
    stdout: "",
    stderr: "",
    ok: false,
  };

  await new Promise((resolve, reject) => {
    const proc = spawn("bash", ["-lc", command], {
      cwd: resolvedCwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let wasAborted = false;

    proc.stdout.on("data", (data) => {
      result.stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      result.stderr += data.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      result.exitCode = code ?? 0;
      result.ok = result.exitCode === 0;
      if (wasAborted) {
        reject(new Error(`Validation command aborted: ${command}`));
        return;
      }
      resolve();
    });

    if (signal) {
      const abortHandler = () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  return result;
}

export async function runValidationSuite({ requiredFiles = [], validationCommands = [], cwd, fallbackCwd, signal }) {
  const fileChecks = await validateRequiredFiles(requiredFiles, cwd, fallbackCwd);
  const commandResults = [];

  for (const command of validationCommands) {
    commandResults.push(await runValidationCommand(command, normalizeCwd(cwd, fallbackCwd), signal));
  }

  const missingFiles = fileChecks.filter((check) => !check.exists);
  const failedCommands = commandResults.filter((commandResult) => !commandResult.ok);

  return {
    fileChecks,
    commandResults,
    ok: missingFiles.length === 0 && failedCommands.length === 0,
    summary: {
      requiredFilesChecked: fileChecks.length,
      commandsRun: commandResults.length,
      missingFiles: missingFiles.length,
      failedCommands: failedCommands.length,
    },
  };
}
