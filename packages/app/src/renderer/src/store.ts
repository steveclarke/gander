import { reactive } from "vue";
import type { OpenTarget, PrListItem, PrView, RepoEntry } from "@gander/shared";
import type { GanderApi, GithubRepository } from "./api.js";
import type { ImagePreview } from "../../api.js";
import type { ServiceStatus } from "../../api.js";

export interface Store {
  repos: RepoEntry[];
  githubRepos: GithubRepository[];
  githubReposBusy: boolean;
  githubReposError: string | null;
  prs: PrListItem[];
  currentRepoId: string | null;
  view: PrView | null;
  selectedPath: string | null;
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
  /** Open what the command line asked for: a repository, and its pull request when one was named. */
  openTarget(target: OpenTarget): Promise<void>;
  selectRepo(repoId: string): Promise<void>;
  openPr(prNumber: number): Promise<void>;
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
    currentRepoId: null,
    view: null,
    selectedPath: null,
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
        store.prs = await api.listPrs(entry.repoId);
        store.currentRepoId = entry.repoId;
        store.view = null;
        store.selectedPath = null;
      })));
    },
    async openTarget(target: OpenTarget) {
      await userAction(() => withBusy(() => guard(async () => {
        // Registering on the spot rather than refusing: whoever ran the command already
        // knows which repository they mean, and an error here would cost the reviewer a
        // detour to add it by hand.
        if (!store.repos.some((r) => r.repoId === target.repoId)) {
          await api.addRepo(`https://github.com/${target.repoId}`);
          store.repos = await api.listRepos();
        }
        // The bodies of selectRepo and openPr, inlined: nesting their busy wrappers would
        // clear the busy flag halfway through this one.
        store.prs = await api.listPrs(target.repoId);
        store.currentRepoId = target.repoId;
        store.view = null;
        store.selectedPath = null;
        if (target.prNumber === null) return;
        store.view = await api.openPr(target.repoId, target.prNumber);
        syncCurrentProgress();
        await store.checkService();
        store.selectedPath = store.view.files[0]?.path ?? null;
        store.lastFetchAt = new Date().toISOString();
      })));
    },
    async selectRepo(repoId: string) {
      await userAction(() => withBusy(() => guard(async () => {
        store.prs = await api.listPrs(repoId);
        store.currentRepoId = repoId;
        store.view = null;
        store.selectedPath = null;
      })));
    },
    async openPr(prNumber: number) {
      await userAction(() => withBusy(() => guard(async () => {
        if (!store.currentRepoId) throw new Error("no repo selected");
        store.view = await api.openPr(store.currentRepoId, prNumber);
        syncCurrentProgress();
        await store.checkService();
        store.selectedPath = store.view.files[0]?.path ?? null;
        store.lastFetchAt = new Date().toISOString();
      })));
    },
    async refresh() {
      await withBusy(() => guard(async () => {
        if (!store.currentRepoId || !store.view) return;
        store.view = await api.refreshPr(store.currentRepoId, store.view.pr.number);
        syncCurrentProgress();
        await store.checkService();
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
    },
    progress() {
      const files = store.view?.files ?? [];
      return { done: files.filter((f) => f.checked).length, total: files.length };
    },
  });

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
