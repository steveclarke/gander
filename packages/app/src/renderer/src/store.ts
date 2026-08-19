import { reactive } from "vue";
import { isUnreachableReason } from "@gander/shared";
import type { ChangedFile, LocalFile, LocalFileEntry, LocalView, LocalWorktree, OpenTarget, PrListItem, PrView, RepoEntry } from "@gander/shared";
import type { GanderApi } from "./api.js";
import type { ImagePreview } from "../../api.js";
import type { ServiceStatus } from "../../api.js";

export interface Store {
  repos: RepoEntry[];
  prs: PrListItem[];
  worktrees: LocalWorktree[];
  currentRepoId: string | null;
  /** Repository the workbench modes operate on, independent of whichever view is loaded. */
  targetRepoId: string | null;
  /** Worktree Explorer and Current Diff return to after visiting a pull request. */
  targetWorktreePath: string | null;
  /** Pull request the Pull Requests mode returns to after visiting a local worktree. */
  selectedPrNumber: number | null;
  view: PrView | null;
  localView: LocalView | null;
  selectedPath: string | null;
  localFiles: LocalFileEntry[];
  /** Directories whose immediate children Explorer has loaded for the selected worktree. */
  loadedLocalDirectories: string[];
  localFile: LocalFile | null;
  localSurface: "explorer" | "changes";
  error: string | null;
  /** Reachability and compatibility from the service's version handshake. */
  serviceStatus: ServiceStatus;
  /** When the pull request was last fetched from origin, as an ISO string. */
  lastFetchAt: string | null;
  /** True while a long-running main-process action is in flight. Not for setChecked/setCheckedMany — those are near-instant and shouldn't flicker a "busy" indicator. */
  busy: boolean;
  loadRepos(): Promise<void>;
  checkService(): Promise<void>;
  dismissError(): void;
  /** Reopen the pull request that was open when the app last closed. */
  restoreLastReview(): Promise<void>;
  chooseLocalRepo(expectedRepoId?: string): Promise<boolean>;
  removeRepo(repoId: string): Promise<void>;
  /** Open what the command line asked for: a repository, and its pull request when one was named. */
  openTarget(target: OpenTarget): Promise<void>;
  selectRepo(repoId: string): Promise<void>;
  openPr(prNumber: number): Promise<void>;
  openLocal(path: string): Promise<void>;
  loadLocalDirectory(directory: string): Promise<void>;
  showLocalSurface(surface: "explorer" | "changes"): void;
  refresh(): Promise<void>;
  /** The reviewer pressing Fetch origin: same work as refresh, but it clears a stale error. */
  fetchNow(): Promise<void>;
  setChecked(path: string, checked: boolean): Promise<void>;
  setCheckedMany(paths: string[], checked: boolean): Promise<void>;
  reviewedSnapshot(path: string): Promise<string | null>;
  imagePreview(path: string): Promise<ImagePreview | null>;
  addNote(text: string, path: string | null, line: number | null): Promise<void>;
  deleteNote(id: number): Promise<void>;
  select(path: string): void;
  files(): ChangedFile[];
  isLocal(): boolean;
  progress(): { done: number; total: number };
}

/**
 * The message without Electron's plumbing in front of it.
 *
 * An error thrown in the main process arrives wrapped: "Error invoking remote method
 * 'gander:listPrs': Error: ...". That tells the reviewer which IPC channel failed, in a
 * banner whose only job is to say what went wrong.
 */
export function readable(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^(?:Error|TypeError):\s*/, "");
}

export function createStore(api: GanderApi): Store {
  let localFileRequest = 0;
  let localContextGeneration = 0;
  let targetContextRequest = 0;
  let explorerMutation = Promise.resolve();

  function syncCurrentProgress(): void {
    if (!store.view) return;
    const item = store.prs.find((pr) => pr.number === store.view?.pr.number);
    if (!item) return;
    const done = store.view.files.filter((file) => file.checked).length;
    // Once progress exists, an explicit un-check remains progress: the retained
    // snapshot means this review has begun even when its current count returns to zero.
    if (item.reviewProgress !== null || done > 0 || store.view.files.some((file) => file.changedSince)) {
      item.reviewProgress = { done, total: store.view.files.length };
    }
  }
  const store: Store = reactive({
    repos: [],
    prs: [],
    worktrees: [],
    currentRepoId: null,
    targetRepoId: null,
    targetWorktreePath: null,
    selectedPrNumber: null,
    view: null,
    localView: null,
    selectedPath: null,
    localFiles: [],
    loadedLocalDirectories: [],
    localFile: null,
    localSurface: "explorer",
    error: null,
    serviceStatus: { state: "unreachable", reason: "Checking the Gander service…" },
    lastFetchAt: null,
    busy: false,

    async loadRepos() {
      await guard(async () => {
        store.repos = await api.listRepos();
      });
    },
    async checkService() {
      const previous = store.serviceStatus;
      store.serviceStatus = await api.serviceStatus();
      // A read can fail during launch and leave exactly the health-check reason in the
      // banner. Opening a large local checkout can outlive the health poll that recovers,
      // then restore that old reason after the status is already connected; recognize the
      // health-check sentence as well as the immediately previous reason. Failed writes use
      // a different sentence with their no-retry consequence and deliberately stay visible.
      if ((store.serviceStatus.state === "connected" || store.serviceStatus.state === "newer")
        && ((previous.state === "unreachable" && store.error === previous.reason)
          || (isUnreachableReason(store.error ?? "")
            && !store.error?.includes("This change was not saved and will not be retried.")))) {
        store.error = null;
      }
    },
    dismissError() {
      store.error = null;
    },
    async restoreLastReview() {
      const last = await api.lastReview();
      if (!last) return;
      // A repository can be removed from the config, or a pull request merged and its
      // refs gone, between one launch and the next. Neither is an error worth a banner
      // on startup — the app just opens on the empty state instead.
      if (!store.repos.some((r) => r.repoId === last.repoId)) return;
      await store.selectRepo(last.repoId);
      if (store.error) { store.error = null; return; }
      await store.openPr(last.prNumber);
      if (store.error) store.error = null;
    },
    async chooseLocalRepo(expectedRepoId) {
      let chosen = false;
      await userAction(() => withBusy(() => guard(async () => {
        const entry = await api.chooseLocalRepo(expectedRepoId);
        if (!entry) return;
        chosen = true;
        store.repos = await api.listRepos();
        await activateRepo(entry.repoId);
        store.selectedPrNumber = null;
      })));
      return chosen;
    },
    async removeRepo(repoId) {
      await userAction(() => withBusy(() => guard(async () => {
        await api.removeRepo(repoId);
        if (store.targetRepoId === repoId) {
          await clearLoadedView();
          store.targetRepoId = null;
          store.targetWorktreePath = null;
          store.selectedPrNumber = null;
          store.prs = [];
          store.worktrees = [];
        }
        store.repos = await api.listRepos();
      })));
    },
    async openTarget(target: OpenTarget) {
      await userAction(() => withBusy(() => guard(async () => {
        // bin/gander can register a repository as it opens one, which happens in the main
        // process after this list was last read. Re-read before refusing, or the first
        // open of a checkout the app has not seen always fails.
        if (!store.repos.some((r) => r.repoId === target.repoId)) store.repos = await api.listRepos();
        if (!store.repos.some((r) => r.repoId === target.repoId)) {
          throw new Error(`${target.repoId} is not registered. Open one of its checkout folders first.`);
        }
        // The bodies of selectRepo and openPr, called without their busy wrappers: nesting
        // those would clear the busy flag halfway through this one.
        await activateRepo(target.repoId);
        if (target.prNumber === null) return;
        // Taken after activateRepo, not before: switching repositories clears the loaded
        // view, which bumps the counter, and a generation read earlier would then look
        // superseded by this call's own work — leaving the repository open and the pull
        // request never opened.
        await applyOpenedPr(target.repoId, target.prNumber, ++localContextGeneration);
      })));
    },
    async selectRepo(repoId: string) {
      await userAction(() => withBusy(() => guard(() => activateRepo(repoId))));
    },
    async openPr(prNumber: number) {
      await userAction(() => withBusy(() => guard(async () => {
        const repoId = store.targetRepoId;
        if (!repoId) throw new Error("no repo selected");
        await applyOpenedPr(repoId, prNumber, ++localContextGeneration);
      })));
    },
    async openLocal(path: string) {
      await userAction(() => withBusy(() => guard(async () => {
        const repoId = store.targetRepoId;
        if (!repoId) throw new Error("no repo selected");
        localFileRequest++;
        const generation = ++localContextGeneration;
        const localView = await api.openLocal(repoId, path);
        if (generation !== localContextGeneration) return;
        store.localView = localView;
        store.currentRepoId = repoId;
        store.targetWorktreePath = path;
        store.view = null;
        store.selectedPath = store.localView.files[0]?.path ?? null;
        const localFiles = await api.listLocalFiles(path, "");
        if (generation !== localContextGeneration) return;
        store.localFiles = localFiles;
        store.loadedLocalDirectories = [];
        store.localSurface = "explorer";
        store.selectedPath = firstLocalFilePath();
        const localFile = store.selectedPath ? await api.localFile(path, store.selectedPath) : null;
        if (generation !== localContextGeneration) return;
        store.localFile = localFile;
        store.lastFetchAt = new Date().toISOString();
      })));
    },
    async loadLocalDirectory(directory: string) {
      if (store.loadedLocalDirectories.includes(directory)) return;
      await userAction(() => withExplorerMutation(() => guard(async () => {
        if (!store.localView) throw new Error("no local worktree open");
        const worktreePath = store.localView.worktree.path;
        const generation = localContextGeneration;
        const entries = await api.listLocalFiles(worktreePath, directory);
        if (generation !== localContextGeneration || store.localView?.worktree.path !== worktreePath) return;
        store.localFiles = [
          ...store.localFiles.filter((entry) => parentDirectory(entry.path) !== directory),
          ...entries,
        ];
        store.loadedLocalDirectories.push(directory);
      })));
    },
    showLocalSurface(surface) {
      if (!store.localView) return;
      store.localSurface = surface;
      if (surface === "changes" && !store.localView.files.some((file) => file.path === store.selectedPath)) {
        store.selectedPath = store.localView.files[0]?.path ?? null;
      } else if (surface === "explorer" && !store.localFiles.some((file) => file.kind === "file" && file.path === store.selectedPath)) {
        store.selectedPath = firstLocalFilePath();
      }
      if (surface === "explorer" && store.selectedPath) void selectLocalFile(store.selectedPath);
    },
    async refresh() {
      await withBusy(() => guard(async () => {
        if (store.localView) {
          const worktreePath = store.localView.worktree.path;
          const generation = localContextGeneration;
          // The poll can still be in flight when the reviewer opens something else, which
          // closes this worktree in the main process. Its refusal then means this request
          // was superseded, not that anything failed, so it must not reach the reviewer as
          // an error about a worktree they have already left.
          let refreshed;
          try {
            refreshed = await api.refreshLocal(worktreePath);
          } catch (err) {
            if (superseded(generation, worktreePath)) return;
            throw err;
          }
          if (superseded(generation, worktreePath)) return;
          applyLocalView(refreshed);
          await refreshExplorer();
        } else if (store.currentRepoId && store.view) {
          store.view = await api.refreshPr(store.currentRepoId, store.view.pr.number);
          syncCurrentProgress();
          await store.checkService();
        } else return;
        store.lastFetchAt = new Date().toISOString();
      }));
    },
    async fetchNow() {
      await userAction(() => store.refresh());
    },
    async setChecked(path: string, checked: boolean) {
      await guard(async () => {
        const { repoId, prNumber } = requireOpenPr();
        store.view = await api.setChecked(repoId, prNumber, path, checked);
        syncCurrentProgress();
      });
    },
    async setCheckedMany(paths: string[], checked: boolean) {
      await guard(async () => {
        const { repoId, prNumber } = requireOpenPr();
        store.view = await api.setCheckedMany(repoId, prNumber, paths, checked);
        syncCurrentProgress();
      });
    },
    async reviewedSnapshot(path: string) {
      if (!store.currentRepoId || !store.view) return null;
      return api.reviewedSnapshot(store.currentRepoId, store.view.pr.number, path);
    },
    async imagePreview(path: string) {
      if (store.localView) return api.localImagePreview(path);
      if (!store.currentRepoId || !store.view) return null;
      return api.imagePreview(store.currentRepoId, store.view.pr.number, path);
    },
    async addNote(text: string, path: string | null, line: number | null) {
      await guard(async () => {
        const { repoId, prNumber } = requireOpenPr();
        store.view = await api.addNote(repoId, prNumber, { path, line, text });
      });
    },
    async deleteNote(id: number) {
      await guard(async () => {
        const { repoId, prNumber } = requireOpenPr();
        store.view = await api.deleteNote(repoId, prNumber, id);
      });
    },
    select(path: string) {
      store.selectedPath = path;
      if (store.localView && store.localSurface === "explorer") void selectLocalFile(path);
    },
    files() {
      return store.localView?.files ?? store.view?.files ?? [];
    },
    isLocal() {
      return store.localView !== null;
    },
    progress() {
      const files = store.view?.files ?? [];
      return { done: files.filter((f) => f.checked).length, total: files.length };
    },
  });

  api.onLocalViewChanged((update) => {
    if (store.localView?.worktree.path !== update.path) return;
    if (update.view === null) {
      store.error = update.error;
      return;
    }
    applyLocalView(update.view);
    void refreshExplorer().catch((err: Error) => { store.error = err.message; });
    store.lastFetchAt = new Date().toISOString();
  });

  function applyLocalView(view: LocalView): void {
    store.localView = view;
    if (store.localSurface === "changes" && !view.files.some((file) => file.path === store.selectedPath)) {
      store.selectedPath = view.files[0]?.path ?? null;
    }
  }

  async function selectLocalFile(path: string): Promise<void> {
    if (!store.localView) return;
    const request = ++localFileRequest;
    const worktreePath = store.localView.worktree.path;
    store.localFile = null;
    try {
      const file = await api.localFile(worktreePath, path);
      if (request === localFileRequest && store.localView?.worktree.path === worktreePath && store.selectedPath === path) {
        store.localFile = file;
      }
    } catch (err) {
      if (request !== localFileRequest) return;
      store.error = (err as Error).message;
      store.localFile = null;
    }
  }

  /** True once the reviewer has moved on from the worktree a request was made for. */
  function superseded(generation: number, worktreePath: string): boolean {
    return generation !== localContextGeneration || store.localView?.worktree.path !== worktreePath;
  }

  async function refreshExplorer(): Promise<void> {
    await withExplorerMutation(refreshExplorerNow);
  }

  async function refreshExplorerNow(): Promise<void> {
    if (!store.localView) return;
    const worktreePath = store.localView.worktree.path;
    const generation = localContextGeneration;
    const files = await api.listLocalFiles(worktreePath, "");
    const stillExpanded: string[] = [];
    for (const directory of [...store.loadedLocalDirectories].sort((left, right) => left.split("/").length - right.split("/").length)) {
      if (!files.some((entry) => entry.kind === "directory" && entry.path === directory)) continue;
      files.push(...await api.listLocalFiles(worktreePath, directory));
      stillExpanded.push(directory);
    }
    if (generation !== localContextGeneration || store.localView?.worktree.path !== worktreePath) return;
    store.localFiles = files;
    store.loadedLocalDirectories = stillExpanded;
    if (store.localSurface !== "explorer") return;
    if (!store.localFiles.some((file) => file.kind === "file" && file.path === store.selectedPath)) {
      store.selectedPath = firstLocalFilePath();
    }
    if (store.selectedPath) await selectLocalFile(store.selectedPath);
    else store.localFile = null;
  }

  async function withExplorerMutation(fn: () => Promise<void>): Promise<void> {
    const operation = explorerMutation.then(fn, fn);
    explorerMutation = operation.catch(() => {});
    await operation;
  }

  function firstLocalFilePath(): string | null {
    return store.localFiles.find((entry) => entry.kind === "file")?.path ?? null;
  }

  function parentDirectory(path: string): string {
    const separator = path.lastIndexOf("/");
    return separator < 0 ? "" : path.slice(0, separator);
  }

  async function loadContexts(repoId: string): Promise<void> {
    const request = ++targetContextRequest;
    const [prs, worktrees] = await Promise.allSettled([api.listPrs(repoId), api.listWorktrees(repoId)]);
    if (request !== targetContextRequest) return;
    store.prs = prs.status === "fulfilled" ? prs.value : [];
    store.worktrees = worktrees.status === "fulfilled" ? worktrees.value : [];
    const errors = [prs, worktrees]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason as Error).message);
    if (errors.length) throw new Error(errors.join("\n"));
  }

  function preferredWorktreePath(repoId: string): string | null {
    const registered = store.repos.find((repo) => repo.repoId === repoId)?.localPath;
    return store.worktrees.find((worktree) => worktree.path === store.targetWorktreePath)?.path
      ?? store.worktrees.find((worktree) => worktree.path === registered)?.path
      ?? store.worktrees[0]?.path
      ?? null;
  }

  function requireOpenPr(): { repoId: string; prNumber: number } {
    if (!store.currentRepoId || !store.view) throw new Error("no PR open");
    return { repoId: store.currentRepoId, prNumber: store.view.pr.number };
  }

  /** Makes a repository the target and loads its pull requests and worktrees. */
  async function activateRepo(repoId: string): Promise<void> {
    await prepareTargetRepo(repoId);
    try {
      await loadContexts(repoId);
    } finally {
      // A GitHub failure must not make a usable local checkout disappear, but a slow
      // superseded load must not rewrite the target chosen after it either.
      if (store.targetRepoId === repoId) store.targetWorktreePath = preferredWorktreePath(repoId);
    }
  }

  /** Opens a pull request and lands the view on it, unless a later open superseded this one. */
  async function applyOpenedPr(repoId: string, prNumber: number, generation: number): Promise<void> {
    const view = await api.openPr(repoId, prNumber);
    if (generation !== localContextGeneration) return;
    store.view = view;
    store.currentRepoId = repoId;
    store.localView = null;
    store.selectedPrNumber = prNumber;
    syncCurrentProgress();
    await store.checkService();
    store.selectedPath = view.files[0]?.path ?? null;
    store.lastFetchAt = new Date().toISOString();
  }

  async function prepareTargetRepo(repoId: string): Promise<void> {
    if (store.targetRepoId === repoId) return;
    if (store.currentRepoId !== null || store.view !== null || store.localView !== null) await clearLoadedView();
    store.targetRepoId = repoId;
    store.targetWorktreePath = null;
    store.selectedPrNumber = null;
  }

  async function clearLoadedView(): Promise<void> {
    localContextGeneration++;
    localFileRequest++;
    await api.closeLocal();
    store.currentRepoId = null;
    store.view = null;
    store.localView = null;
    store.localFiles = [];
    store.loadedLocalDirectories = [];
    store.localFile = null;
    store.selectedPath = null;
  }

  // An error stays on screen until the reviewer dismisses it or starts something new.
  // Clearing it on any success meant the 30-second poll wiped failures before they
  // could be read — the app looked fine while nothing had actually worked.
  async function guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      store.error = readable((err as Error).message);
      // Failed service writes already surface above; update the persistent status too.
      // This is only a health read, never a retry of the authored-state mutation.
      await store.checkService();
    }
  }

  // Wraps the actions the reviewer starts themselves. Those do clear the previous
  // error: they are the reviewer saying "try again".
  async function userAction(fn: () => Promise<void>): Promise<void> {
    store.error = null;
    await fn();
  }

  async function withBusy(fn: () => Promise<void>): Promise<void> {
    store.busy = true;
    try {
      await fn();
    } finally {
      store.busy = false;
    }
  }

  return store;
}
