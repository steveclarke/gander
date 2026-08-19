import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { repoIdFromUrl, type OpenTarget, type RepoEntry } from "@gander/shared";
import { connectionIsFromEnvironment, loadConfig, resolveServiceConnection, saveConfig, type GanderConfig } from "./config.js";
import { checkConnection } from "./connection.js";
import { parseOpenTarget } from "./cli.js";
import { createGitEngine } from "./git.js";
import { checkGithubToken, listGithubRepositories, listOpenPrs, resolveGithubToken } from "./github.js";
import { startOpenServer } from "./open-socket.js";
import { createReviewer } from "./review.js";
import { createServiceClient } from "./service-client.js";
import { registerSettingsIpc } from "./settings-ipc.js";
import { buildMenuTemplate } from "./menu.js";
import { updateNativeWindowTheme, windowAppearance } from "./window-appearance.js";
import { linkedWorktreeLabel } from "./development-context.js";
import { createZoomController, type ZoomController } from "./zoom-controller.js";

let zoomController: ZoomController;

async function bootstrap(): Promise<GanderConfig> {
  const cfg = loadConfig();
  const git = createGitEngine(join(app.getPath("userData"), "clones"));
  // Resolved per request rather than captured: the reviewer can enter or change the
  // connection in settings, and it takes effect without a restart.
  const service = createServiceClient(() => resolveServiceConnection(cfg));
  // Resolved per call for the same reason, and lazily: an installed app launched from
  // Finder gets a minimal PATH with no `gh` on it, which must leave the window open and
  // the settings reachable rather than killing the launch.
  const githubToken = async (): Promise<string> => resolveGithubToken(cfg.githubToken);
  const urlFor = (repoId: string): string => {
    const entry = cfg.repos.find((r) => r.repoId === repoId);
    if (!entry) throw new Error(`Repo ${repoId} is not registered`);
    return entry.url;
  };
  const reviewer = createReviewer({
    git, service,
    listPrs: async (repoId) => listOpenPrs(repoId, await githubToken()),
    repoUrl: urlFor,
    machine: hostname(),
  });

  ipcMain.handle("gander:listRepos", async () => cfg.repos);
  ipcMain.handle("gander:listGithubRepos", async () => listGithubRepositories(await githubToken()));
  ipcMain.handle("gander:addRepo", async (_e, url: string): Promise<RepoEntry> => {
    const entry = { repoId: repoIdFromUrl(url), url };
    if (!cfg.repos.some((r) => r.repoId === entry.repoId)) { cfg.repos.push(entry); saveConfig(cfg); }
    return entry;
  });
  ipcMain.handle("gander:listPrs", async (_e, repoId: string) => reviewer.listPrsWithProgress(repoId));
  ipcMain.handle("gander:serviceStatus", async () => service.status());
  ipcMain.handle("gander:lastReview", async () => cfg.lastReview ?? null);
  ipcMain.handle("gander:initialTarget", async () => launchTarget);
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
  ipcMain.handle("gander:imagePreview", async (_e, repoId: string, n: number, path: string) => reviewer.imagePreview(repoId, n, path));
  ipcMain.handle("gander:addQuestion", async (_e, repoId: string, n: number, input: { path: string | null; line: number | null; text: string }) => reviewer.addQuestion(repoId, n, input));
  ipcMain.handle("gander:addReviewerReply", async (_e, repoId: string, n: number, id: number, text: string) => reviewer.addReviewerReply(repoId, n, id, text));
  ipcMain.handle("gander:deleteQuestion", async (_e, repoId: string, n: number, id: number) => reviewer.deleteQuestion(repoId, n, id));
  ipcMain.handle("gander:setCheckedMany", async (_e, repoId: string, n: number, paths: string[], checked: boolean) => reviewer.setCheckedMany(repoId, n, paths, checked));
  // Connection is deliberately not part of the settings document: that document is
  // editable as JSON in the app, and the token does not belong on screen in a text editor.
  ipcMain.handle("gander:getConnection", async () => ({
    url: cfg.serviceUrl,
    token: cfg.serviceToken,
    githubToken: cfg.githubToken ?? "",
    fromEnvironment: connectionIsFromEnvironment(),
  }));
  ipcMain.handle("gander:setGithubToken", async (_e, token: string) => {
    const trimmed = token.trim();
    // Emptying it is how the reviewer goes back to whatever `gh` provides.
    if (trimmed === "") {
      delete cfg.githubToken;
      saveConfig(cfg);
      return { ok: true as const, login: "" };
    }
    const result = await checkGithubToken(trimmed);
    if (!result.ok) return result;
    cfg.githubToken = trimmed;
    saveConfig(cfg);
    return result;
  });
  ipcMain.handle("gander:testConnection", async (_e, url: string, token: string) => checkConnection(url, token));
  ipcMain.handle("gander:setConnection", async (_e, url: string, token: string) => {
    const result = await checkConnection(url, token);
    // Saved only once it answers. A connection that has never worked is not worth
    // keeping, and finding out at the next launch is worse than finding out now.
    if (!result.ok) return result;
    cfg.serviceUrl = url.trim().replace(/\/+$/, "");
    cfg.serviceToken = token.trim();
    saveConfig(cfg);
    return result;
  });

  zoomController = createZoomController(cfg, () => BrowserWindow.getAllWindows());
  ipcMain.handle("gander:getZoomLevel", async () => zoomController.current());
  ipcMain.handle("gander:setZoomLevel", async (_event, level: number) => zoomController.set(level));

  registerSettingsIpc(ipcMain, cfg, saveConfig, (settings) => {
    updateNativeWindowTheme(process.platform, BrowserWindow.getAllWindows(), settings.workbench.colorTheme);
    zoomController.apply(settings.window.zoomLevel);
  });

  return cfg;
}

function installMenu(): void {
  const openSettings = (): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    win?.webContents.send("gander:openSettings");
  };
  const template = buildMenuTemplate(process.platform, app.name, {
    openSettings,
    setZoom: zoomController.set,
    currentZoom: zoomController.current,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(cfg: GanderConfig): Promise<void> {
  // electron-vite sets this only while its live renderer server is running. Packaged,
  // unsigned, and E2E builds load the built renderer and retain the release identity.
  const isDevelopment = process.env.ELECTRON_RENDERER_URL !== undefined;
  const worktreeLabel = isDevelopment ? await linkedWorktreeLabel(process.cwd()) : null;
  const appearance = windowAppearance(
    process.platform,
    cfg.settings.workbench.colorTheme,
    isDevelopment,
    worktreeLabel,
  );
  // Lives outside the bundle so it survives electron-vite's build untouched. The path is
  // relative to out/main/, which is where this file runs from in dev and after a build alike.
  const appIcon = nativeImage.createFromPath(join(import.meta.dirname, "../../resources", appearance.iconFilename));
  const win = new BrowserWindow({
    width: 1360, height: 860,
    ...appearance.windowOptions,
    // Ignored on macOS, where the dock icon comes from the bundle — app.dock.setIcon covers that.
    icon: appIcon,
    // sandbox: false — our preload output is an ES module (index.mjs, from "type": "module");
    // Electron's default sandboxed preload context cannot load ESM, so window.gander would
    // silently never be defined. contextIsolation stays at its secure default and
    // nodeIntegration is not enabled.
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
      additionalArguments: appearance.preloadArguments,
    },
  });
  // On macOS the web content paints beneath the traffic lights. Reveal only the themed
  // first frame so the system never exposes its default light backing surface.
  if (process.platform === "darwin") win.once("ready-to-show", () => win.show());
  // Unpackaged runs show Electron's own icon in the dock; this is the only way to override it.
  if (!appIcon.isEmpty()) app.dock?.setIcon(appIcon);
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
  win.webContents.on("did-finish-load", () => win.webContents.setZoomLevel(cfg.settings.window.zoomLevel));

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

function socketPath(): string {
  // process-compose passes the per-checkout path outport computed. A launch without it —
  // the end-to-end suite, or running the built app directly — gets one beside its own
  // user data, which is still the right pairing for that launch.
  return process.env.GANDER_APP_SOCKET ?? join(app.getPath("userData"), "app.sock");
}

function deliver(target: OpenTarget): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win === undefined) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send("gander:openTarget", target);
}

// What this launch was asked to open. Parsed before anything starts, so a failure is a
// message on stderr rather than a window opened on the wrong review.
let launchTarget: OpenTarget | null = null;
try {
  launchTarget = parseOpenTarget(process.argv.slice(1));
} catch (err) {
  console.error((err as Error).message);
  app.exit(2);
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
  installMenu();
  await createWindow(cfg);

  try {
    const stop = await startOpenServer({ socketPath: socketPath(), onTarget: deliver });
    app.on("will-quit", stop);
  } catch (err) {
    // Losing the socket costs `bin/gander`, not the app. Reviewing by hand still works.
    console.error(`Could not listen for open requests: ${(err as Error).message}`);
  }
});
app.on("window-all-closed", () => app.quit());
