import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { repoIdFromUrl, type RepoEntry } from "@gander/shared";
import { loadConfig, resolveServiceConnection, saveConfig, type GanderConfig } from "./config.js";
import { createGitEngine } from "./git.js";
import { listOpenPrs, resolveGithubToken } from "./github.js";
import { createReviewer } from "./review.js";
import { createServiceClient } from "./service-client.js";

async function bootstrap(): Promise<GanderConfig> {
  const cfg = loadConfig();
  const ghToken = await resolveGithubToken(cfg.githubToken);
  const git = createGitEngine(join(app.getPath("userData"), "clones"));
  const conn = resolveServiceConnection(cfg);
  const service = createServiceClient(conn.url, conn.token);
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
  ipcMain.handle("gander:serviceHealthy", async () => service.healthy());
  ipcMain.handle("gander:lastReview", async () => cfg.lastReview ?? null);
  ipcMain.handle("gander:openPr", async (_e, repoId: string, n: number) => {
    const view = await reviewer.openPr(repoId, n);
    // Recorded only once the open succeeded, so a pull request that fails to open
    // is not the one the app tries again on every launch.
    cfg.lastReview = { repoId, prNumber: n };
    saveConfig(cfg);
    return view;
  });
  ipcMain.handle("gander:refreshPr", async (_e, repoId: string, n: number) => reviewer.refreshPr(repoId, n));
  ipcMain.handle("gander:setChecked", async (_e, repoId: string, n: number, path: string, checked: boolean) => reviewer.setChecked(repoId, n, path, checked));
  ipcMain.handle("gander:reviewedSnapshot", async (_e, repoId: string, n: number, path: string) => reviewer.reviewedSnapshot(repoId, n, path));
  ipcMain.handle("gander:addQuestion", async (_e, repoId: string, n: number, input: { path: string | null; line: number | null; text: string }) => reviewer.addQuestion(repoId, n, input));
  ipcMain.handle("gander:deleteQuestion", async (_e, repoId: string, n: number, id: number) => reviewer.deleteQuestion(repoId, n, id));
  ipcMain.handle("gander:setCheckedMany", async (_e, repoId: string, n: number, paths: string[], checked: boolean) => reviewer.setCheckedMany(repoId, n, paths, checked));

  return cfg;
}

// Electron's built-in zoom roles change the level but forget it on quit. These do the
// same steps — 0.5 matches Chromium's own increment — and write the result to the
// config, so the window reopens at the size the reader chose.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 6;

function installMenu(cfg: GanderConfig): void {
  const setZoom = (level: number): void => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
    for (const win of BrowserWindow.getAllWindows()) win.webContents.setZoomLevel(clamped);
    cfg.zoomLevel = clamped;
    saveConfig(cfg);
  };
  const currentZoom = (): number => BrowserWindow.getFocusedWindow()?.webContents.getZoomLevel() ?? cfg.zoomLevel ?? 0;

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: () => setZoom(currentZoom() + ZOOM_STEP) },
        // Chromium delivers Cmd+= for an unshifted Cmd+ on most layouts; both are bound
        // so the key next to Backspace works without reaching for Shift.
        { label: "Zoom In", accelerator: "CommandOrControl+=", visible: false, click: () => setZoom(currentZoom() + ZOOM_STEP) },
        { label: "Zoom Out", accelerator: "CommandOrControl+-", click: () => setZoom(currentZoom() - ZOOM_STEP) },
        { label: "Actual Size", accelerator: "CommandOrControl+0", click: () => setZoom(0) },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(cfg: GanderConfig): void {
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

  // Applied on every load, not just the first: Chromium resets zoom per navigation,
  // and the dev server reloads the renderer on every edit.
  win.webContents.on("did-finish-load", () => win.webContents.setZoomLevel(cfg.zoomLevel ?? 0));

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  let cfg: GanderConfig;
  try {
    cfg = await bootstrap();
  } catch (err) {
    dialog.showErrorBox("Gander failed to start", (err as Error).message);
    app.exit(1);
    return;
  }
  installMenu(cfg);
  createWindow(cfg);
});
app.on("window-all-closed", () => app.quit());
