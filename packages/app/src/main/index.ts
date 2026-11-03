import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { type LocalView, type OpenTarget, type RepoEntry, type PrView, type UpdateNote } from "@gander/shared";
import { connectionIsFromEnvironment, loadConfig, saveConfig, type GanderConfig, type SavedWindow, type WindowBounds } from "./config.js";
import { parseOpenTarget } from "./cli.js";
import { createGitEngine, type GitEngine } from "./git.js";
import { checkGithubToken, getGithubAccount, githubApiUrl, isPullRequestOpen, isRetryableGithubError, listOpenPrs, resolveGithubToken, setFileViewed } from "./github.js";
import { createGithubViewedQueue, type GithubAccount, type GithubViewedQueue } from "./github-viewed-queue.js";
import { startOpenServer } from "./open-socket.js";
import type { Reviewer, CheckoffResult } from "./review.js";
import { createServerRouting, withReviewSession } from "./server-routing.js";
import { registerServersIpc } from "./servers-ipc.js";
import { createServerChooser } from "./server-choice.js";
import { createRepositoryServers, type RepositoryServers } from "./repository-servers.js";
import { registerSettingsIpc } from "./settings-ipc.js";
import { buildMenuTemplate } from "./menu.js";
import { updateNativeWindowTheme, windowAppearance } from "./window-appearance.js";
import { revealWindow, windowIsHidden } from "./window-visibility.js";
import { linkedWorktreeLabel } from "./development-context.js";
import { createZoomController, type ZoomController } from "./zoom-controller.js";
import { watchLocalView, type LocalViewWatcher } from "./local-viewer.js";
import { loadUpdateController, supportsInPlaceUpdates, type UpdateController } from "./updates.js";
import { assertRepositoryRegistered, registerFromCheckout, repositoryFromLocalPath } from "./repository-registration.js";
import { boundsOnScreen, ensureNoOverlap, reviewOf, routeOpen, sameReview, windowsToRestore, type WindowReview } from "./window-routing.js";

// In a packaged build the name comes from productName, but in dev Electron falls back to
// the package name and the macOS app menu reads "@gander/app". Set it before ready so the
// menu, the About item, and userData all use the same name in both.
app.setName("Gander");

// Renderer debugging: with GANDER_DEBUG_PORT set, the window speaks CDP on that port, so
// DevTools — or a script driving Runtime.evaluate and Page.captureScreenshot — can inspect
// the running app's layout without rebuilding it. Never in a packaged build: the port has
// no auth and would expose the reviewer's window to anything on the machine.
const debugPort = process.env.GANDER_DEBUG_PORT;
if (debugPort && !app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", debugPort);

let zoomController: ZoomController;

// One review per window. Keyed by the window's webContents id, which is what every IPC
// handler already has as event.sender.id.
interface WindowState {
  win: BrowserWindow;
  /** What the window opens with: a target named on the command line, routed here, or restored. */
  initial: OpenTarget | null;
  review: WindowReview | null;
  /**
   * On its way in, or failed to open: counts for routing and is saved, so a restart with
   * the service down brings the window back to try again rather than dropping it.
   */
  pending: WindowReview | null;
  title: string;
}
const windowStates = new Map<number, WindowState>();
/** The window the reviewer was last in, the way VS Code tracks its last active window. */
let lastActive: WindowState | null = null;
let quitting = false;
/** Where the last window sat when it closed, for the window a Dock click opens. */
let lastClosedBounds: WindowBounds | undefined;

function showTitle(state: WindowState): void {
  if (!state.win.isDestroyed()) state.win.setTitle(state.title);
}

/** "#12 Fix the parser — atlas": the review first, then its repository, as VS Code names a window. */
function reviewTitle(repoId: string, prNumber: number, prTitle?: string): string {
  const repoName = repoId.split("/").pop() ?? repoId;
  return `#${prNumber}${prTitle ? ` ${prTitle}` : ""} — ${repoName}`;
}

/** What a window is showing or about to show, for routing. */
const shown = (state: WindowState): WindowReview | null => state.review ?? state.pending;

function findShowing(repoId: string, prNumber: number): WindowState | undefined {
  return [...windowStates.values()].find((state) => sameReview(shown(state), repoId, prNumber));
}

function roundBounds(bounds: Electron.Rectangle): WindowBounds {
  return { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
}

/** Saved in opening order with the last active window last, as VS Code saves its session. */
function saveWindows(cfg: GanderConfig): boolean {
  const states = [...windowStates.values()];
  const ordered = lastActive && states.includes(lastActive) ? [...states.filter((state) => state !== lastActive), lastActive] : states;
  const windows: SavedWindow[] = ordered.flatMap((state) => {
    const review = shown(state);
    if (!review) return [];
    return [state.win.isDestroyed() ? review : { ...review, bounds: roundBounds(state.win.getNormalBounds()) }];
  });
  // Restoring several windows opens each one; only a list that changed is written.
  if (JSON.stringify(windows) === JSON.stringify(cfg.windows ?? [])) return false;
  cfg.windows = windows;
  saveConfig(cfg);
  return true;
}
const localWatchers = new Map<number, LocalViewWatcher>();
const localViews = new Map<number, LocalView>();
const localOpenGenerations = new Map<number, number>();

function closeLocalView(senderId: number): void {
  localWatchers.get(senderId)?.close();
  localWatchers.delete(senderId);
  localViews.delete(senderId);
}

/** Invalidates any open still in flight for this window, so a superseded one discards its result. */
function nextLocalOpenGeneration(senderId: number): number {
  const generation = (localOpenGenerations.get(senderId) ?? 0) + 1;
  localOpenGenerations.set(senderId, generation);
  return generation;
}

// The renderer names the worktree on every read; only the one this window actually has
// open may be read through, whatever path arrives over IPC.
function requireOpenWorktree(senderId: number, path: string): void {
  if (localViews.get(senderId)?.worktree.path !== path) {
    throw new Error(`${path} is not the open local worktree`);
  }
}

async function bootstrap(): Promise<{ cfg: GanderConfig; git: GitEngine; githubViewedQueue: GithubViewedQueue; repositoryServers: RepositoryServers }> {
  const cfg = loadConfig();
  const repositoryServers = createRepositoryServers(cfg, createServerChooser(ipcMain, () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null));
  const git = createGitEngine(join(app.getPath("userData"), "clones"));
  // Resolved per request rather than captured: the reviewer can enter or change the
  // connection in settings, and it takes effect without a restart.
  // Resolved per call for the same reason, and lazily: an installed app launched from
  // Finder gets a minimal PATH with no `gh` on it, which must leave the window open and
  // the settings reachable rather than killing the launch.
  const githubToken = async (): Promise<string> => resolveGithubToken(cfg.githubToken);
  let accountCache: { token: string; account: GithubAccount } | null = null;
  let activeAccount: GithubAccount | null = null;
  async function accountForToken(token: string): Promise<GithubAccount> {
    if (accountCache?.token === token) return accountCache.account;
    const account = await getGithubAccount(token);
    accountCache = { token, account };
    return account;
  }
  async function githubConnection(): Promise<{ token: string; account: GithubAccount }> {
    const token = await githubToken();
    return { token, account: await accountForToken(token) };
  }
  const githubViewedQueue = createGithubViewedQueue({
    path: join(app.getPath("userData"), "github-viewed-queue.json"),
    currentAccount: async () => (await githubConnection()).account,
    send: async (job) => {
      const connection = await githubConnection();
      if (connection.account.apiUrl !== job.account.apiUrl || connection.account.login !== job.account.login) {
        throw new Error(`GitHub is signed in as ${connection.account.login}, not ${job.account.login}`);
      }
      await setFileViewed(job.pullRequestId, job.path, job.viewed, connection.token);
    },
    pullRequestOpen: async (job) => isPullRequestOpen(job.pullRequestId, (await githubConnection()).token),
    retryable: isRetryableGithubError,
    onStatus: (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("gander:githubViewedSyncStatus", status);
      }
    },
  });
  const requireRepo = (repoId: string): RepoEntry => {
    const entry = cfg.repos.find((r) => r.repoId === repoId);
    if (!entry) throw new Error(`Repo ${repoId} is not registered`);
    return entry;
  };
  const routing = createServerRouting(cfg, {
    git,
    listPrs: async (repoId) => {
      const token = await githubToken();
      const [account, prs] = await Promise.all([
        accountForToken(token),
        listOpenPrs(repoId, token),
      ]);
      activeAccount = account;
      return prs;
    },
    enqueueFilesViewed: (pullRequestId, paths, viewed) => {
      if (!activeAccount) throw new Error("GitHub account is not known; refresh the pull request and try again");
      githubViewedQueue.enqueue(activeAccount, pullRequestId, paths, viewed);
    },
    repoUrl: (repoId) => requireRepo(repoId).url,
    machine: hostname(),
  });

  const viewOnServer = async (repoId: string, action: (reviewer: Reviewer) => Promise<PrView>, expected?: string) => {
    const { result, sessionId } = await withReviewSession(routing, repoId, action, expected);
    return { ...result, reviewSessionId: sessionId };
  };
  const checkOnServer = async (repoId: string, action: (reviewer: Reviewer) => Promise<CheckoffResult>, expected: string) => {
    const { result, sessionId } = await withReviewSession(routing, repoId, action, expected);
    return { ...result, view: { ...result.view, reviewSessionId: sessionId } };
  };
  const requireSession = (sessionId: unknown): string => {
    if (typeof sessionId !== "string") throw new Error("Reopen the review before making changes.");
    return sessionId;
  };

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
    if (existing) {
      Object.assign(existing, entry);
      entry.serverId = existing.serverId;
    } else {
      const assignment = await repositoryServers.assign(entry.repoId, entry.url);
      const concurrent = cfg.repos.find((repo) => repo.repoId === entry.repoId);
      if (concurrent) Object.assign(concurrent, entry);
      else cfg.repos.push({ ...entry, ...assignment });
      Object.assign(entry, concurrent ? { serverId: concurrent.serverId, serverSource: concurrent.serverSource } : assignment);
    }
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
    return git.listWorktrees(requireRepo(repoId).localPath);
  });
  ipcMain.handle("gander:openLocal", async (event, repoId: string, path: string) => {
    const senderId = event.sender.id;
    const generation = nextLocalOpenGeneration(senderId);
    const worktrees = await git.listWorktrees(requireRepo(repoId).localPath);
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
    const state = windowStates.get(senderId);
    if (state) {
      state.review = null;
      state.pending = null;
      state.title = view.worktree.branch ? `${view.worktree.branch} — local` : "Gander";
      showTitle(state);
      saveWindows(cfg);
    }
    event.sender.once("destroyed", () => closeLocalView(senderId));
    return view;
  });
  ipcMain.handle("gander:refreshLocal", async (event, path: string) => {
    requireOpenWorktree(event.sender.id, path);
    const view = await git.localView(path);
    localViews.set(event.sender.id, view);
    return view;
  });
  ipcMain.handle("gander:listLocalFiles", async (event, path: string, directory = "") => {
    requireOpenWorktree(event.sender.id, path);
    return git.listLocalFiles(path, directory);
  });
  ipcMain.handle("gander:localFile", async (event, path: string, filePath: string) => {
    requireOpenWorktree(event.sender.id, path);
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
    nextLocalOpenGeneration(event.sender.id);
    closeLocalView(event.sender.id);
    // The renderer calls this when the reviewer switches repository: whatever review the
    // window showed is gone, so routing may use the window and restore must not bring it back.
    // A pull request on its way in stays claimed.
    const state = windowStates.get(event.sender.id);
    if (state?.review) {
      state.review = null;
      if (!state.pending) {
        state.title = "Gander";
        showTitle(state);
      }
      saveWindows(cfg);
    }
  });
  ipcMain.handle("gander:listPrs", async (_e, repoId: string) => (await withReviewSession(routing, repoId, (reviewer) => reviewer.listPrsWithProgress(repoId))).result);
  ipcMain.handle("gander:serviceStatus", async (_e, repoId?: string) => {
    const session = routing(repoId);
    const [status, claimLost] = await Promise.all([
      session.service.status(),
      repoId === undefined ? false : repositoryServers.claimLost(repoId),
    ]);
    return { ...status, serverName: session.name, ...(claimLost ? { claimLost } : {}) };
  });
  ipcMain.handle("gander:githubViewedSyncStatus", async () => githubViewedQueue.status());
  ipcMain.handle("gander:retryGithubViewedSync", async () => githubViewedQueue.retryFailed());
  ipcMain.handle("gander:dismissGithubViewedSync", async () => githubViewedQueue.dismissFailed());
  ipcMain.handle("gander:lastReview", async () => cfg.lastReview ?? null);
  ipcMain.handle("gander:initialTarget", async (event) => windowStates.get(event.sender.id)?.initial ?? null);
  ipcMain.handle("gander:focusOpenReview", async (event, repoId: string, n: number) => {
    const showing = findShowing(repoId, n);
    if (!showing || showing.win.webContents.id === event.sender.id) return false;
    revealWindow(showing.win);
    return true;
  });
  ipcMain.handle("gander:openInNewWindow", async (_event, repoId: string, n: number) => {
    const showing = findShowing(repoId, n);
    if (showing) { revealWindow(showing.win); return; }
    await createWindow(cfg, { target: { repoId, prNumber: n } });
  });
  ipcMain.handle("gander:openPr", async (event, repoId: string, n: number) => {
    const senderId = event.sender.id;
    const generation = nextLocalOpenGeneration(senderId);
    // A failed open throws past here and leaves the window's pending review in place: the
    // window still shows that pull request's error, an open of it focuses the window to try
    // again, and a restart with the service down does not lose it.
    const view: PrView = await viewOnServer(repoId, (reviewer) => reviewer.openPr(repoId, n));
    if (localOpenGenerations.get(senderId) !== generation) return view;
    // Preserve the live local view when opening the PR fails. The renderer keeps showing
    // that context, so its watcher and validated file-reading state must remain usable too.
    closeLocalView(senderId);
    const state = windowStates.get(senderId);
    if (state) {
      state.review = { repoId, prNumber: n };
      state.pending = null;
      state.title = reviewTitle(repoId, n, view.pr.title);
      showTitle(state);
    }
    // Recorded only once the open succeeded, so a pull request that fails to open
    // is not the one the app tries again on every launch.
    const lastReviewChanged = !sameReview(cfg.lastReview ?? null, repoId, n);
    cfg.lastReview = { repoId, prNumber: n };
    if (!saveWindows(cfg) && lastReviewChanged) saveConfig(cfg);
    return view;
  });
  ipcMain.handle("gander:refreshPr", async (_e, repoId: string, n: number, sessionId?: string) => viewOnServer(repoId, (reviewer) => reviewer.refreshPr(repoId, n), sessionId));
  ipcMain.handle("gander:setChecked", async (_e, repoId: string, n: number, path: string, checked: boolean, sessionId: string) => checkOnServer(repoId, (reviewer) => reviewer.setChecked(repoId, n, path, checked), requireSession(sessionId)));
  ipcMain.handle("gander:reviewedSnapshot", async (_e, repoId: string, n: number, path: string, sessionId: string) => (await withReviewSession(routing, repoId, (reviewer) => reviewer.reviewedSnapshot(repoId, n, path), requireSession(sessionId))).result);
  ipcMain.handle("gander:imagePreview", async (_e, repoId: string, n: number, path: string, sessionId: string) => (await withReviewSession(routing, repoId, (reviewer) => reviewer.imagePreview(repoId, n, path), requireSession(sessionId))).result);
  ipcMain.handle("gander:addNote", async (_e, repoId: string, n: number, input: { path: string | null; line: number | null; text: string }, sessionId: string) => viewOnServer(repoId, (reviewer) => reviewer.addNote(repoId, n, input), requireSession(sessionId)));
  ipcMain.handle("gander:updateNote", async (_e, repoId: string, n: number, id: number, input: UpdateNote, sessionId: string) => viewOnServer(repoId, (reviewer) => reviewer.updateNote(repoId, n, id, input), requireSession(sessionId)));
  ipcMain.handle("gander:deleteNote", async (_e, repoId: string, n: number, id: number, sessionId: string) => viewOnServer(repoId, (reviewer) => reviewer.deleteNote(repoId, n, id), requireSession(sessionId)));
  ipcMain.handle("gander:setCheckedMany", async (_e, repoId: string, n: number, paths: string[], checked: boolean, sessionId: string) => checkOnServer(repoId, (reviewer) => reviewer.setCheckedMany(repoId, n, paths, checked), requireSession(sessionId)));
  // Connection is deliberately not part of the settings document: that document is
  // editable as JSON in the app, and the token does not belong on screen in a text editor.
  registerServersIpc(ipcMain, cfg, saveConfig, () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("gander:serversChanged");
  }, repositoryServers);
  ipcMain.handle("gander:setGithubToken", async (_e, token: string) => {
    const trimmed = token.trim();
    // Emptying it is how the reviewer goes back to whatever `gh` provides.
    if (trimmed === "") {
      delete cfg.githubToken;
      accountCache = null;
      activeAccount = null;
      saveConfig(cfg);
      githubViewedQueue.retryFailed();
      return { ok: true as const, login: "" };
    }
    const result = await checkGithubToken(trimmed);
    if (!result.ok) return result;
    cfg.githubToken = trimmed;
    const account = { apiUrl: githubApiUrl(), login: result.login };
    accountCache = { token: trimmed, account };
    activeAccount = account;
    saveConfig(cfg);
    githubViewedQueue.retryFailed();
    return result;
  });
  zoomController = createZoomController(cfg, () => BrowserWindow.getAllWindows());
  ipcMain.handle("gander:getZoomLevel", async () => zoomController.current());
  ipcMain.handle("gander:setZoomLevel", async (_event, level: number) => zoomController.set(level));

  registerSettingsIpc(ipcMain, cfg, saveConfig, (settings) => {
    updateNativeWindowTheme(process.platform, BrowserWindow.getAllWindows(), settings.workbench.colorTheme);
    zoomController.apply(settings.window.zoomLevel);
  });

  githubViewedQueue.start();
  return { cfg, git, githubViewedQueue, repositoryServers };
}

function installMenu(cfg: GanderConfig, updates: UpdateController | null): void {
  const openSettings = (): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    win?.webContents.send("gander:openSettings");
  };
  const template = buildMenuTemplate(process.platform, app.name, {
    openSettings,
    newWindow: () => newWindow(cfg),
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

interface WindowOptions {
  target?: OpenTarget | null;
  /** Where the window sat last time, when it is being restored. */
  bounds?: WindowBounds;
  /** Take focus once shown. Restored windows other than the last active one do not. */
  focus?: boolean;
}

const DEFAULT_WIDTH = 1360;
const DEFAULT_HEIGHT = 860;

/**
 * Where a new window goes, as VS Code places one (windowsStateHandler.ts): saved bounds
 * when they are still on a display; otherwise centred on the display under the cursor on
 * macOS, or the last active window's display elsewhere, stepped 30px down and right while
 * another window sits at the same x or y.
 */
function placeWindow(saved: WindowBounds | undefined): WindowBounds {
  const displays = screen.getAllDisplays();
  const restored = boundsOnScreen(saved, displays.map((display) => display.workArea));
  if (restored) return restored;
  const reference = lastActive && !lastActive.win.isDestroyed() ? lastActive.win.getBounds() : null;
  const display = process.platform === "darwin" || !reference
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : screen.getDisplayMatching(reference);
  const area = display.workArea;
  const width = Math.min(DEFAULT_WIDTH, area.width);
  const height = Math.min(DEFAULT_HEIGHT, area.height);
  const centred = { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2) };
  const open = [...windowStates.values()].filter((state) => !state.win.isDestroyed()).map((state) => state.win.getBounds());
  return { ...ensureNoOverlap(centred, open), width, height };
}

async function createWindow(cfg: GanderConfig, options: WindowOptions = {}): Promise<BrowserWindow> {
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
  const hidden = windowIsHidden();
  // Lives outside the bundle so it survives electron-vite's build untouched. The path is
  // relative to out/main/, which is where this file runs from in dev and after a build alike.
  const appIcon = nativeImage.createFromPath(join(import.meta.dirname, "../../resources", appearance.iconFilename));
  // A plain window of its own, as VS Code opens one: no macOS window tabs (VS Code sets a
  // tabbingIdentifier only when window.nativeTabs is on, and it is off by default).
  const win = new BrowserWindow({
    ...placeWindow(options.bounds),
    ...appearance.windowOptions,
    ...(hidden ? { show: false, skipTaskbar: true } : {}),
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
  const id = win.webContents.id;
  const target = options.target ?? null;
  const state: WindowState = {
    win,
    initial: target,
    // Claimed before the renderer has opened it, so an open routed meanwhile does not
    // count this window as empty and land on top of it.
    review: null,
    pending: reviewOf(target),
    title: target?.prNumber ? reviewTitle(target.repoId, target.prNumber) : "Gander",
  };
  windowStates.set(id, state);
  showTitle(state);
  // The renderer's <title> would otherwise overwrite the pull request the window is named for.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.on("focus", () => { lastActive = state; });
  win.on("close", () => { lastClosedBounds = roundBounds(win.getNormalBounds()); });
  win.on("closed", () => {
    windowStates.delete(id);
    if (lastActive === state) lastActive = null;
    closeLocalView(id);
    // Closing the last window keeps the list as it was, so the next launch brings it back.
    if (!quitting && windowStates.size > 0) saveWindows(cfg);
  });
  // On macOS the web content paints beneath the traffic lights. Reveal only the themed
  // first frame so the system never exposes its default light backing surface.
  if (process.platform === "darwin" && !hidden) win.once("ready-to-show", () => {
    if (options.focus === false) win.showInactive();
    else revealWindow(win);
  });
  if (hidden) app.dock?.hide();
  // Unpackaged runs show Electron's own icon in the dock; this is the only way to override it.
  if (!hidden && !appIcon.isEmpty()) app.dock?.setIcon(appIcon);
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
  return win;
}

/** File → New Window (⇧⌘N), and the Dock menu's New Window: an empty review window. */
function newWindow(cfg: GanderConfig): void {
  void createWindow(cfg);
}

function socketPath(): string {
  // process-compose passes the per-checkout path outport computed. A launch without it —
  // the end-to-end suite, or running the built app directly — gets one beside its own
  // user data, which is still the right pairing for that launch.
  return process.env.GANDER_APP_SOCKET ?? join(app.getPath("userData"), "app.sock");
}

function deliver(cfg: GanderConfig, target: OpenTarget): void {
  const focused = BrowserWindow.getFocusedWindow();
  const windows = [...windowStates.entries()].map(([id, state]) => ({ id, review: shown(state), local: localViews.has(id) }));
  const route = routeOpen(windows, target, focused?.webContents.id ?? null);
  // A new window comes to the front and takes focus, as VS Code's does for `code <path>`.
  if (route.kind === "new") {
    void createWindow(cfg, { target });
    return;
  }
  const state = windowStates.get(route.id);
  if (!state) return;
  revealWindow(state.win);
  // Reusing an empty window, or focusing one whose review never finished opening (it
  // failed, or the renderer had not mounted when it was sent): send it the target. It is
  // also the window's initial target, which a renderer still mounting reads on start.
  if (route.kind === "reuse" || state.review === null) {
    state.pending = reviewOf(target) ?? state.pending;
    state.initial = target;
    state.win.webContents.send("gander:openTarget", target);
  }
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
  let git: GitEngine;
  let githubViewedQueue: GithubViewedQueue;
  let repositoryServers: RepositoryServers;
  try {
    ({ cfg, git, githubViewedQueue, repositoryServers } = await bootstrap());
    if (launchTarget !== null) assertRepositoryRegistered(cfg.repos, launchTarget.repoId);
  } catch (err) {
    dialog.showErrorBox("Gander failed to start", (err as Error).message);
    app.exit(1);
    return;
  }
  // Every review window comes back where it was, the last active one in front, the way VS
  // Code restores a session (window.restoreWindows: all). A target named on the command line
  // is then routed like any other open, so an agent's launch never costs the open reviews.
  const restore = windowsToRestore(cfg.windows, cfg.lastReview).filter((review) => cfg.repos.some((repo) => repo.repoId === review.repoId));
  if (restore.length === 0) {
    await createWindow(cfg, { target: launchTarget });
  } else {
    for (const [index, saved] of restore.entries()) {
      const front = index === restore.length - 1 && launchTarget === null;
      await createWindow(cfg, { target: { repoId: saved.repoId, prNumber: saved.prNumber }, bounds: saved.bounds, focus: front });
    }
    if (launchTarget !== null) deliver(cfg, launchTarget);
  }
  app.on("before-quit", () => {
    quitting = true;
    // After the last window closed on macOS there is nothing open; the list it left stays.
    if (windowStates.size > 0) saveWindows(cfg);
  });
  // macOS keeps the app running with no windows, as VS Code does; the Dock icon then opens
  // one where the last one was, and the Dock menu offers New Window.
  app.on("activate", () => {
    if (windowStates.size === 0) void createWindow(cfg, { bounds: lastClosedBounds });
  });
  app.dock?.setMenu(Menu.buildFromTemplate([{ label: "New Window", click: () => newWindow(cfg) }]));
  const updates = await initializeUpdates();
  installMenu(cfg, updates);
  updates?.checkAtStartup();
  app.on("will-quit", () => githubViewedQueue.stop());

  try {
    const stop = await startOpenServer({
      socketPath: socketPath(),
      onTarget: async (target, from) => {
        // An agent that just pushed a branch should not need the reviewer to click through
        // a folder dialog first. The request carries the checkout it came from, which is
        // the same evidence the picker collects.
        const added = await registerFromCheckout(git, () => cfg.repos, target.repoId, from, async (entry) => {
          Object.assign(entry, await repositoryServers.assign(entry.repoId, entry.url));
        });
        if (added !== null) saveConfig(cfg);
        deliver(cfg, target);
      },
    });
    app.on("will-quit", stop);
  } catch (err) {
    // Losing the socket costs `bin/gander`, not the app. Reviewing by hand still works.
    console.error(`Could not listen for open requests: ${(err as Error).message}`);
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
