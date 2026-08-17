import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { repoIdFromUrl, type RepoEntry } from "@gander/shared";
import { loadConfig, saveConfig } from "./config.js";
import { createGitEngine } from "./git.js";
import { listOpenPrs, resolveGithubToken } from "./github.js";
import { createReviewer } from "./review.js";
import { createServiceClient } from "./service-client.js";

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const ghToken = await resolveGithubToken(cfg.githubToken);
  const git = createGitEngine(join(app.getPath("userData"), "clones"));
  const service = createServiceClient(cfg.serviceUrl, cfg.serviceToken);
  const urlFor = (repoId: string): string => {
    const entry = cfg.repos.find((r) => r.repoId === repoId);
    if (!entry) throw new Error(`Repo ${repoId} is not registered`);
    return entry.url;
  };
  const reviewer = createReviewer({
    git, service,
    listPrs: (repoId) => listOpenPrs(repoId, ghToken),
    repoUrl: urlFor,
    machine: hostname(),
  });

  ipcMain.handle("gander:listRepos", async () => cfg.repos);
  ipcMain.handle("gander:addRepo", async (_e, url: string): Promise<RepoEntry> => {
    const entry = { repoId: repoIdFromUrl(url), url };
    if (!cfg.repos.some((r) => r.repoId === entry.repoId)) { cfg.repos.push(entry); saveConfig(cfg); }
    return entry;
  });
  ipcMain.handle("gander:listPrs", async (_e, repoId: string) => listOpenPrs(repoId, ghToken));
  ipcMain.handle("gander:openPr", async (_e, repoId: string, n: number) => reviewer.openPr(repoId, n));
  ipcMain.handle("gander:refreshPr", async (_e, repoId: string, n: number) => reviewer.refreshPr(repoId, n));
  ipcMain.handle("gander:setChecked", async (_e, repoId: string, n: number, path: string, checked: boolean) => reviewer.setChecked(repoId, n, path, checked));
  ipcMain.handle("gander:setCheckedMany", async (_e, repoId: string, n: number, paths: string[], checked: boolean) => reviewer.setCheckedMany(repoId, n, paths, checked));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360, height: 860,
    backgroundColor: "#16181d",
    // sandbox: false — our preload output is an ES module (index.mjs, from "type": "module");
    // Electron's default sandboxed preload context cannot load ESM, so window.gander would
    // silently never be defined. contextIsolation stays at its secure default and
    // nodeIntegration is not enabled.
    webPreferences: { preload: join(import.meta.dirname, "../preload/index.mjs"), sandbox: false },
  });
  // The renderer's whole input is arbitrary repo content — Monaco link-detects URLs inside
  // reviewed files — so a window this preload is attached to must never be allowed to
  // navigate away or spawn a same-preload child window. Electron would otherwise carry the
  // `window.gander` bridge (git + GitHub + service client) to whatever page loads next.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (err) {
    dialog.showErrorBox("Gander failed to start", (err as Error).message);
    app.exit(1);
    return;
  }
  createWindow();
});
app.on("window-all-closed", () => app.quit());
