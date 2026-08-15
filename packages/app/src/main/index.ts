import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

const CHANNELS = ["listRepos", "addRepo", "listPrs", "openPr", "setChecked", "setCheckedMany", "refreshPr"] as const;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360, height: 860,
    backgroundColor: "#16181d",
    webPreferences: { preload: join(import.meta.dirname, "../preload/index.mjs") },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

for (const ch of CHANNELS) {
  ipcMain.handle(`gander:${ch}`, async () => { throw new Error(`gander:${ch} not implemented yet`); });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
