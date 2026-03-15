import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFile);

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
