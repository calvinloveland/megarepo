import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function extractAssistantText(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function getPiInvocation(args) {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

async function writeTempPrompt(workerName, promptText) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-hiring-harness-"));
  const safeName = String(workerName || "worker").replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tempDir, `${safeName}.md`);
  await fs.writeFile(filePath, promptText, { encoding: "utf-8", mode: 0o600 });
  return { tempDir, filePath };
}

async function cleanupTempPrompt(tempDir, filePath) {
  if (filePath) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
  if (tempDir) {
    try {
      await fs.rmdir(tempDir);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function runWorkerPrompt({ defaultCwd, worker, prompt, cwd, signal, onUpdate }) {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (worker.model) args.push("--model", worker.model);
  if (worker.tools?.length) args.push("--tools", worker.tools.join(","));

  const systemPromptParts = [];
  if (worker.systemPrompt) systemPromptParts.push(worker.systemPrompt.trim());
  systemPromptParts.push("Do not call hire_workers or hire sub-workers.");
  const combinedSystemPrompt = systemPromptParts.join("\n\n").trim();

  let tempDir = null;
  let tempFilePath = null;

  const result = {
    workerName: worker.name,
    model: worker.model,
    exitCode: 0,
    stderr: "",
    stopReason: undefined,
    errorMessage: undefined,
    assistantMessages: [],
    finalOutput: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
  };

  try {
    if (combinedSystemPrompt) {
      const tempPrompt = await writeTempPrompt(worker.name, combinedSystemPrompt);
      tempDir = tempPrompt.tempDir;
      tempFilePath = tempPrompt.filePath;
      args.push("--append-system-prompt", tempFilePath);
    }

    args.push(prompt);

    await new Promise((resolve, reject) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuffer = "";
      let wasAborted = false;

      const processLine = (line) => {
        if (!line.trim()) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type !== "message_end" || !event.message || event.message.role !== "assistant") return;

        result.assistantMessages.push(event.message);
        result.finalOutput = extractAssistantText(event.message) || result.finalOutput;
        result.usage.turns += 1;

        const usage = event.message.usage;
        if (usage) {
          result.usage.input += usage.input || 0;
          result.usage.output += usage.output || 0;
          result.usage.cacheRead += usage.cacheRead || 0;
          result.usage.cacheWrite += usage.cacheWrite || 0;
          result.usage.cost += usage.cost?.total || 0;
          result.usage.contextTokens = usage.totalTokens || result.usage.contextTokens;
        }

        if (!result.model && event.message.model) result.model = event.message.model;
        if (event.message.stopReason) result.stopReason = event.message.stopReason;
        if (event.message.errorMessage) result.errorMessage = event.message.errorMessage;
        if (typeof onUpdate === "function") onUpdate({ ...result });
      };

      proc.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        result.stderr += data.toString();
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (stdoutBuffer.trim()) processLine(stdoutBuffer);
        result.exitCode = code ?? 0;
        if (wasAborted) {
          reject(new Error("Worker subprocess aborted."));
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
  } finally {
    await cleanupTempPrompt(tempDir, tempFilePath);
  }
}
