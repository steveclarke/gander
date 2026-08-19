import { reactive } from "vue";
import type { ChangedFile, LocalFile, LocalFileEntry, LocalView, LocalWorktree, OpenTarget, PrListItem, PrView, RepoEntry } from "@gander/shared";
import type { GanderApi, GithubRepository } from "./api.js";
import type { ImagePreview } from "../../api.js";
import type { ServiceStatus } from "../../api.js";

export interface Store {
  repos: RepoEntry[];
  githubRepos: GithubRepository[];
  githubReposBusy: boolean;
  githubReposError: string | null;
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
  localFile: LocalFile | null;
  localSurface: "explorer" | "changes";
  error: string | null;
  /** Reachability and compatibility from the service's version handshake. */
  serviceStatus: ServiceStatus;
  /** When the pull request was last fetched from origin, as an ISO string. */
  lastFetchAt: string | null;
  /** True while a long-running main-process action (openPr, refresh, addRepo, selectRepo) is in flight. Not for setChecked/setCheckedMany — those are near-instant and shouldn't flicker a "busy" indicator. */
  busy: boolean;
  loadRepos(): Promise<void>;
  loadGithubRepos(): Promise<void>;
  checkService(): Promise<void>;
  dismissError(): void;
  /** Reopen the pull request that was open when the app last closed. */
  restoreLastReview(): Promise<void>;
  addRepo(url: string): Promise<void>;
  chooseLocalRepo(): Promise<boolean>;
  /** Open what the command line asked for: a repository, and its pull request when one was named. */
  openTarget(target: OpenTarget): Promise<void>;
  selectRepo(repoId: string): Promise<void>;
  openPr(prNumber: number): Promise<void>;
  openLocal(path: string): Promise<void>;
  showLocalSurface(surface: "explorer" | "changes"): void;
  refresh(): Promise<void>;
  /** The reviewer pressing Fetch origin: same work as refresh, but it clears a stale error. */
  fetchNow(): Promise<void>;
  setChecked(path: string, checked: boolean): Promise<void>;
  setCheckedMany(paths: string[], checked: boolean): Promise<void>;
  reviewedSnapshot(path: string): Promise<string | null>;
  imagePreview(path: string): Promise<ImagePreview | null>;
  addQuestion(text: string, path: string | null, line: number | null): Promise<void>;
  addReviewerReply(id: number, text: string): Promise<void>;
  deleteQuestion(id: number): Promise<void>;
  select(path: string): void;
  files(): ChangedFile[];
  isLocal(): boolean;
  progress(): { done: number; total: number };
}

export function createStore(api: GanderApi): Store {
  let localFileRequest = 0;
  let localContextGeneration = 0;
  let targetContextRequest = 0;

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
    githubRepos: [],
    githubReposBusy: false,
    githubReposError: null,
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
    async loadGithubRepos() {
      store.githubReposBusy = true;
      store.githubReposError = null;
      try {
        store.githubRepos = await api.listGithubRepos();
      } catch (err) {
        store.githubReposError = (err as Error).message;
      } finally {
        store.githubReposBusy = false;
      }
    },
    async checkService() {
      store.serviceStatus = await api.serviceStatus();
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
    async addRepo(url: string) {
      await userAction(() => withBusy(() => guard(async () => {
        const entry = await api.addRepo(url);
        store.repos = await api.listRepos();
        await prepareTargetRepo(entry.repoId);
        try {
          await loadContexts(entry.repoId);
        } finally {
          if (store.targetRepoId === entry.repoId) store.targetWorktreePath = preferredWorktreePath(entry.repoId);
        }
        store.selectedPrNumber = null;
      })));
    },
    async chooseLocalRepo() {
      let chosen = false;
      await userAction(() => withBusy(() => guard(async () => {
        const entry = await api.chooseLocalRepo();
        if (!entry) return;
        chosen = true;
        store.repos = await api.listRepos();
        await prepareTargetRepo(entry.repoId);
        try {
          await loadContexts(entry.repoId);
        } finally {
          if (store.targetRepoId === entry.repoId) store.targetWorktreePath = preferredWorktreePath(entry.repoId);
        }
        store.selectedPrNumber = null;
      })));
      return chosen;
    },
    async openTarget(target: OpenTarget) {
      await userAction(() => withBusy(() => guard(async () => {
        const generation = target.prNumber === null ? null : ++localContextGeneration;
        // Registering on the spot rather than refusing: whoever ran the command already
        // knows which repository they mean, and an error here would cost the reviewer a
        // detour to add it by hand.
        if (!store.repos.some((r) => r.repoId === target.repoId)) {
          await api.addRepo(`https://github.com/${target.repoId}`);
          store.repos = await api.listRepos();
        }
        // The bodies of selectRepo and openPr, inlined: nesting their busy wrappers would
        // clear the busy flag halfway through this one.
        await prepareTargetRepo(target.repoId);
        try {
          await loadContexts(target.repoId);
        } finally {
          if (store.targetRepoId === target.repoId) store.targetWorktreePath = preferredWorktreePath(target.repoId);
        }
        if (target.prNumber === null) return;
        if (generation !== localContextGeneration) return;
        const view = await api.openPr(target.repoId, target.prNumber);
        if (generation !== localContextGeneration) return;
        store.view = view;
        store.currentRepoId = target.repoId;
        store.localView = null;
        store.selectedPrNumber = target.prNumber;
        syncCurrentProgress();
        await store.checkService();
        store.selectedPath = store.view.files[0]?.path ?? null;
        store.lastFetchAt = new Date().toISOString();
      })));
    },
    async selectRepo(repoId: string) {
      await userAction(() => withBusy(() => guard(async () => {
        await prepareTargetRepo(repoId);
        try {
          await loadContexts(repoId);
        } finally {
          // A GitHub failure must not make a usable local checkout disappear, but a slow
          // superseded load must not rewrite the target chosen after it either.
          if (store.targetRepoId === repoId) store.targetWorktreePath = preferredWorktreePath(repoId);
        }
      })));
    },
    async openPr(prNumber: number) {
      await userAction(() => withBusy(() => guard(async () => {
        const repoId = store.targetRepoId;
        if (!repoId) throw new Error("no repo selected");
        const generation = ++localContextGeneration;
        const view = await api.openPr(repoId, prNumber);
        if (generation !== localContextGeneration) return;
        store.view = view;
        store.currentRepoId = repoId;
        store.localView = null;
        store.selectedPrNumber = prNumber;
        syncCurrentProgress();
        await store.checkService();
        store.selectedPath = store.view.files[0]?.path ?? null;
        store.lastFetchAt = new Date().toISOString();
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
        const localFiles = await api.listLocalFiles(path);
        if (generation !== localContextGeneration) return;
        store.localFiles = localFiles;
        store.localSurface = "explorer";
        store.selectedPath = store.localFiles[0]?.path ?? null;
        const localFile = store.selectedPath ? await api.localFile(path, store.selectedPath) : null;
        if (generation !== localContextGeneration) return;
        store.localFile = localFile;
        store.lastFetchAt = new Date().toISOString();
      })));
    },
    showLocalSurface(surface) {
      if (!store.localView) return;
      store.localSurface = surface;
      if (surface === "changes" && !store.localView.files.some((file) => file.path === store.selectedPath)) {
        store.selectedPath = store.localView.files[0]?.path ?? null;
      } else if (surface === "explorer" && !store.localFiles.some((file) => file.path === store.selectedPath)) {
        store.selectedPath = store.localFiles[0]?.path ?? null;
      }
      if (surface === "explorer" && store.selectedPath) void selectLocalFile(store.selectedPath);
    },
    async refresh() {
      await withBusy(() => guard(async () => {
        if (store.localView) {
          applyLocalView(await api.refreshLocal(store.localView.worktree.path));
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
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.setChecked(store.currentRepoId, store.view.pr.number, path, checked);
        syncCurrentProgress();
      });
    },
    async setCheckedMany(paths: string[], checked: boolean) {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.setCheckedMany(store.currentRepoId, store.view.pr.number, paths, checked);
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
    async addQuestion(text: string, path: string | null, line: number | null) {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.addQuestion(store.currentRepoId, store.view.pr.number, { path, line, text });
      });
    },
    async deleteQuestion(id: number) {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.deleteQuestion(store.currentRepoId, store.view.pr.number, id);
      });
    },
    async addReviewerReply(id: number, text: string) {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.addReviewerReply(store.currentRepoId, store.view.pr.number, id, text);
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

  async function refreshExplorer(): Promise<void> {
    if (!store.localView) return;
    const worktreePath = store.localView.worktree.path;
    const generation = localContextGeneration;
    const files = await api.listLocalFiles(worktreePath);
    if (generation !== localContextGeneration || store.localView?.worktree.path !== worktreePath) return;
    store.localFiles = files;
    if (store.localSurface !== "explorer") return;
    if (!store.localFiles.some((file) => file.path === store.selectedPath)) {
      store.selectedPath = store.localFiles[0]?.path ?? null;
    }
    if (store.selectedPath) await selectLocalFile(store.selectedPath);
    else store.localFile = null;
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
      store.error = (err as Error).message;
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
