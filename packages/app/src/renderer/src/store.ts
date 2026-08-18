import { reactive } from "vue";
import type { PrSummary, PrView, RepoEntry } from "@gander/shared";
import type { GanderApi } from "./api.js";

export interface Store {
  repos: RepoEntry[];
  prs: PrSummary[];
  currentRepoId: string | null;
  view: PrView | null;
  selectedPath: string | null;
  error: string | null;
  /** True while a long-running main-process action (openPr, refresh, addRepo, selectRepo) is in flight. Not for setChecked/setCheckedMany — those are near-instant and shouldn't flicker a "busy" indicator. */
  busy: boolean;
  loadRepos(): Promise<void>;
  /** Reopen the pull request that was open when the app last closed. */
  restoreLastReview(): Promise<void>;
  addRepo(url: string): Promise<void>;
  selectRepo(repoId: string): Promise<void>;
  openPr(prNumber: number): Promise<void>;
  refresh(): Promise<void>;
  setChecked(path: string, checked: boolean): Promise<void>;
  setCheckedMany(paths: string[], checked: boolean): Promise<void>;
  select(path: string): void;
  progress(): { done: number; total: number };
}

export function createStore(api: GanderApi): Store {
  const store: Store = reactive({
    repos: [],
    prs: [],
    currentRepoId: null,
    view: null,
    selectedPath: null,
    error: null,
    busy: false,

    async loadRepos() {
      await guard(async () => {
        store.repos = await api.listRepos();
      });
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
      await withBusy(() => guard(async () => {
        await api.addRepo(url);
        store.repos = await api.listRepos();
      }));
    },
    async selectRepo(repoId: string) {
      await withBusy(() => guard(async () => {
        store.prs = await api.listPrs(repoId);
        store.currentRepoId = repoId;
        store.view = null;
        store.selectedPath = null;
      }));
    },
    async openPr(prNumber: number) {
      await withBusy(() => guard(async () => {
        if (!store.currentRepoId) throw new Error("no repo selected");
        store.view = await api.openPr(store.currentRepoId, prNumber);
        store.selectedPath = store.view.files[0]?.path ?? null;
      }));
    },
    async refresh() {
      await withBusy(() => guard(async () => {
        if (!store.currentRepoId || !store.view) return;
        store.view = await api.refreshPr(store.currentRepoId, store.view.pr.number);
      }));
    },
    async setChecked(path: string, checked: boolean) {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.setChecked(store.currentRepoId, store.view.pr.number, path, checked);
      });
    },
    async setCheckedMany(paths: string[], checked: boolean) {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.setCheckedMany(store.currentRepoId, store.view.pr.number, paths, checked);
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

  async function guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      store.error = null;
    } catch (err) {
      store.error = (err as Error).message;
    }
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
