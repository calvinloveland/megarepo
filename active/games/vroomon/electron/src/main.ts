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

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: join(currentDirectory, "preload.js"),
    },
  });

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
