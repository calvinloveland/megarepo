import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  appendGenerationLogToDisk,
  loadGenerationLogFromDisk,
  loadRunStateFromDisk,
  saveRunStateToDisk,
} from "./main/file-store.js";
import { type GenerationLogEntry } from "./core/persistence.js";
import { type RunStateSnapshot } from "./shared/parity-contract.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFile);
const userDataOverride = process.env.VROOMON_USER_DATA_DIR;
const shouldDisableHardwareAcceleration =
  process.env.VROOMON_DISABLE_HARDWARE_ACCELERATION === "1";
const shouldDisableSandbox = process.env.VROOMON_DISABLE_SANDBOX === "1";
const shouldDisableDevShmUsage = process.env.VROOMON_DISABLE_DEV_SHM_USAGE === "1";
const shouldRunSmokeTest = process.env.VROOMON_SMOKE_TEST === "1";

let smokeTestFinished = false;

if (userDataOverride) {
  app.setPath("userData", userDataOverride);
}

if (shouldDisableHardwareAcceleration) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

if (shouldDisableSandbox) {
  app.commandLine.appendSwitch("no-sandbox");
}

if (shouldDisableDevShmUsage) {
  app.commandLine.appendSwitch("disable-dev-shm-usage");
}

function finishSmokeTest(
  exitCode: number,
  channel: string,
  payload: Record<string, unknown>,
): void {
  if (!shouldRunSmokeTest || smokeTestFinished) {
    return;
  }

  smokeTestFinished = true;
  console.log(`${channel} ${JSON.stringify(payload)}`);
  setImmediate(() => {
    app.exit(exitCode);
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: join(currentDirectory, "preload.mjs"),
      sandbox: false,
    },
  });

  if (shouldRunSmokeTest) {
    const smokeTimeout = setTimeout(() => {
      finishSmokeTest(1, "VROOMON_SMOKE_TIMEOUT", {
        url: window.webContents.getURL(),
      });
    }, 15_000);
    smokeTimeout.unref();

    window.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        console.log(
          `VROOMON_SMOKE_CONSOLE ${JSON.stringify({
            level,
            message,
            line,
            sourceId,
          })}`,
        );
      },
    );
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        clearTimeout(smokeTimeout);
        finishSmokeTest(1, "VROOMON_SMOKE_FAIL", {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        });
      },
    );
    window.webContents.on("render-process-gone", (_event, details) => {
      clearTimeout(smokeTimeout);
      finishSmokeTest(1, "VROOMON_SMOKE_RENDER_GONE", {
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });
    window.webContents.on("did-finish-load", () => {
      void (async () => {
        try {
          const diagnostics = await window.webContents.executeJavaScript(`
            (() => ({
              readyState: document.readyState,
              title: document.title,
              statusMessage:
                document.querySelector("[data-status-message]")?.textContent ?? null,
              activePanels: Array.from(
                document.querySelectorAll("[data-panel][data-active='true']"),
              ).map((panel) => panel.dataset.panel ?? ""),
              hasVroomon: Boolean(window.vroomon),
              bodyPreview: document.body.textContent?.slice(0, 200) ?? "",
            }))();
          `);
          clearTimeout(smokeTimeout);
          finishSmokeTest(0, "VROOMON_SMOKE_SUCCESS", diagnostics);
        } catch (error) {
          clearTimeout(smokeTimeout);
          finishSmokeTest(1, "VROOMON_SMOKE_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });
  }

  void window.loadFile(join(currentDirectory, "renderer", "index.html"));

  return window;
}

app.whenReady().then(() => {
  ipcMain.handle(
    "vroomon:save-run-state",
    (_event, state: RunStateSnapshot) => saveRunStateToDisk(app.getPath("userData"), state),
  );
  ipcMain.handle("vroomon:load-run-state", () =>
    loadRunStateFromDisk(app.getPath("userData")),
  );
  ipcMain.handle(
    "vroomon:append-generation-log",
    (_event, entry: GenerationLogEntry) =>
      appendGenerationLogToDisk(app.getPath("userData"), entry),
  );
  ipcMain.handle("vroomon:load-generation-log", (_event, runId: string) =>
    loadGenerationLogFromDisk(app.getPath("userData"), runId),
  );

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
