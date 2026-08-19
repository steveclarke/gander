import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { type LocalView, type OpenTarget, type RepoEntry } from "@gander/shared";
import { connectionIsFromEnvironment, loadConfig, resolveServiceConnection, saveConfig, type GanderConfig } from "./config.js";
import { checkConnection } from "./connection.js";
import { parseOpenTarget } from "./cli.js";
import { createGitEngine } from "./git.js";
import { checkGithubToken, listOpenPrs, resolveGithubToken } from "./github.js";
import { startOpenServer } from "./open-socket.js";
import { createReviewer } from "./review.js";
import { createServiceClient } from "./service-client.js";
import { registerSettingsIpc } from "./settings-ipc.js";
import { buildMenuTemplate } from "./menu.js";
import { updateNativeWindowTheme, windowAppearance } from "./window-appearance.js";
import { linkedWorktreeLabel } from "./development-context.js";
import { createZoomController, type ZoomController } from "./zoom-controller.js";
import { watchLocalView, type LocalViewWatcher } from "./local-viewer.js";
import { loadUpdateController, supportsInPlaceUpdates, type UpdateController } from "./updates.js";
import { assertRepositoryRegistered, repositoryFromLocalPath } from "./repository-registration.js";

let zoomController: ZoomController;
const localWatchers = new Map<number, LocalViewWatcher>();
const localViews = new Map<number, LocalView>();
const localOpenGenerations = new Map<number, number>();

function closeLocalView(senderId: number): void {
  localWatchers.get(senderId)?.close();
  localWatchers.delete(senderId);
  localViews.delete(senderId);
}

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
  ipcMain.handle("gander:chooseLocalRepo", async (event, expectedRepoId?: string): Promise<RepoEntry | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: expectedRepoId === undefined ? "Open a Git repository" : `Locate a checkout for ${expectedRepoId}`,
      properties: ["openDirectory"],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const entry = await repositoryFromLocalPath(git, selected, expectedRepoId);
    const existing = cfg.repos.find((repo) => repo.repoId === entry.repoId);
    if (existing) Object.assign(existing, entry);
    else cfg.repos.push(entry);
    saveConfig(cfg);
    return entry;
  });
  ipcMain.handle("gander:removeRepo", async (_event, repoId: string): Promise<void> => {
    const index = cfg.repos.findIndex((repo) => repo.repoId === repoId);
    if (index === -1) throw new Error(`Repo ${repoId} is not registered`);
    cfg.repos.splice(index, 1);
    if (cfg.lastReview?.repoId === repoId) delete cfg.lastReview;
    saveConfig(cfg);
  });
  ipcMain.handle("gander:listWorktrees", async (_event, repoId: string) => {
    const repo = cfg.repos.find((entry) => entry.repoId === repoId);
    if (!repo) throw new Error(`Repo ${repoId} is not registered`);
    return git.listWorktrees(repo.localPath);
  });
  ipcMain.handle("gander:openLocal", async (event, repoId: string, path: string) => {
    const senderId = event.sender.id;
    const generation = (localOpenGenerations.get(senderId) ?? 0) + 1;
    localOpenGenerations.set(senderId, generation);
    const repo = cfg.repos.find((entry) => entry.repoId === repoId);
    if (!repo) throw new Error(`Repo ${repoId} is not registered`);
    const worktrees = await git.listWorktrees(repo.localPath);
    const selected = worktrees.find((worktree) => worktree.path === path);
    if (!selected) throw new Error(`${path} is not a worktree of ${repoId}`);
    const view = await git.localView(selected.path);
    const watcher = await watchLocalView(git, selected.path, (update) => {
      if (event.sender.isDestroyed()) {
        closeLocalView(senderId);
        return;
      }
      if (update.view) localViews.set(senderId, update.view);
      event.sender.send("gander:localViewChanged", update);
    }, view);
    if (localOpenGenerations.get(senderId) !== generation) {
      watcher.close();
      return view;
    }
    closeLocalView(senderId);
    localWatchers.set(senderId, watcher);
    localViews.set(senderId, view);
    event.sender.once("destroyed", () => closeLocalView(senderId));
    return view;
  });
  ipcMain.handle("gander:refreshLocal", async (event, path: string) => {
    if (localViews.get(event.sender.id)?.worktree.path !== path) {
      throw new Error(`${path} is not the open local worktree`);
    }
    const view = await git.localView(path);
    localViews.set(event.sender.id, view);
    return view;
  });
  ipcMain.handle("gander:listLocalFiles", async (event, path: string, directory = "") => {
    if (localViews.get(event.sender.id)?.worktree.path !== path) {
      throw new Error(`${path} is not the open local worktree`);
    }
    return git.listLocalFiles(path, directory);
  });
  ipcMain.handle("gander:localFile", async (event, path: string, filePath: string) => {
    if (localViews.get(event.sender.id)?.worktree.path !== path) {
      throw new Error(`${path} is not the open local worktree`);
    }
    return git.localFile(path, filePath);
  });
  ipcMain.handle("gander:localImagePreview", async (event, path: string) => {
    const view = localViews.get(event.sender.id);
    if (!view) throw new Error("A local worktree must be open before previewing an image");
    const file = view.files.find((candidate) => candidate.path === path);
    if (!file) throw new Error(`${path} is not part of the local change`);
    return git.localImage(view.worktree.path, view.mergeBaseSha, path, file.basePath);
  });
  ipcMain.handle("gander:closeLocal", async (event) => {
    localOpenGenerations.set(event.sender.id, (localOpenGenerations.get(event.sender.id) ?? 0) + 1);
    closeLocalView(event.sender.id);
  });
  ipcMain.handle("gander:listPrs", async (_e, repoId: string) => reviewer.listPrsWithProgress(repoId));
  ipcMain.handle("gander:serviceStatus", async () => service.status());
  ipcMain.handle("gander:lastReview", async () => cfg.lastReview ?? null);
  ipcMain.handle("gander:initialTarget", async () => launchTarget);
  ipcMain.handle("gander:openPr", async (event, repoId: string, n: number) => {
    const senderId = event.sender.id;
    const generation = (localOpenGenerations.get(senderId) ?? 0) + 1;
    localOpenGenerations.set(senderId, generation);
    const view = await reviewer.openPr(repoId, n);
    if (localOpenGenerations.get(senderId) !== generation) return view;
    // Preserve the live local view when opening the PR fails. The renderer keeps showing
    // that context, so its watcher and validated file-reading state must remain usable too.
    closeLocalView(senderId);
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

function installMenu(updates: UpdateController | null): void {
  const openSettings = (): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    win?.webContents.send("gander:openSettings");
  };
  const template = buildMenuTemplate(process.platform, app.name, {
    openSettings,
    setZoom: zoomController.set,
    currentZoom: zoomController.current,
    checkForUpdates: updates?.checkManually,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function initializeUpdates(): Promise<UpdateController | null> {
  const updateConfigExists = existsSync(join(process.resourcesPath, "app-update.yml"));
  if (!supportsInPlaceUpdates(app.isPackaged, process.platform, process.env.APPIMAGE, updateConfigExists)) return null;

  try {
    return await loadUpdateController({
      currentVersion: () => app.getVersion(),
      showUpToDate: async (version) => {
        await dialog.showMessageBox({
          type: "info",
          title: "Gander is up to date",
          message: `Gander ${version} is the latest version.`,
        });
      },
      confirmRestart: async (version) => {
        const result = await dialog.showMessageBox({
          type: "info",
          title: "Gander update ready",
          message: `Gander ${version} has been downloaded.`,
          detail: "Restart Gander now to install it, or choose Later to keep reviewing.",
          buttons: ["Restart and Install", "Later"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        return result.response === 0;
      },
      showError: (message) => dialog.showErrorBox("Gander update failed", message),
    });
  } catch (error) {
    // Updating is release infrastructure, not a condition for reviewing. Keep the
    // packaged app usable while making a broken updater visible.
    dialog.showErrorBox("Gander update failed", (error as Error).message);
    return null;
  }
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
    if (launchTarget !== null) assertRepositoryRegistered(cfg.repos, launchTarget.repoId);
  } catch (err) {
    dialog.showErrorBox("Gander failed to start", (err as Error).message);
    app.exit(1);
    return;
  }
  await createWindow(cfg);
  const updates = await initializeUpdates();
  installMenu(updates);
  updates?.checkAtStartup();

  try {
    const stop = await startOpenServer({
      socketPath: socketPath(),
      onTarget: (target) => {
        assertRepositoryRegistered(cfg.repos, target.repoId);
        deliver(target);
      },
    });
    app.on("will-quit", stop);
  } catch (err) {
    // Losing the socket costs `bin/gander`, not the app. Reviewing by hand still works.
    console.error(`Could not listen for open requests: ${(err as Error).message}`);
  }
});
app.on("window-all-closed", () => app.quit());
