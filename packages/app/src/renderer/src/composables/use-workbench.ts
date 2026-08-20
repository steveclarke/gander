import { computed, onBeforeUnmount, onMounted, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { OpenTarget } from "@gander/shared";
import type { GanderApi } from "../api.js";
import type { Store } from "../store.js";

/** The four things the activity rail can put on screen. */
export type WorkbenchMode = "explorer" | "changes" | "pulls" | "settings";
export type SettingsCategory = "workbench" | "editor" | "connection";

type LocalMode = "explorer" | "changes";

export interface Workbench {
  activeMode: ShallowRef<WorkbenchMode>;
  /**
   * Settings covers the work surface instead of replacing it: rebuilding the editor every
   * time the reviewer checks a setting is the cost this avoids.
   */
  surfaceMode: ComputedRef<Exclude<WorkbenchMode, "settings">>;
  settingsCategory: ShallowRef<SettingsCategory>;
  /** No review service is configured, so pull requests are out of reach until one is. */
  unconfigured: ShallowRef<boolean>;
  openSettings(category?: SettingsCategory): void;
  closeSettings(): void;
  onConnected(): Promise<void>;
  openExternalTarget(target: OpenTarget): Promise<void>;
  chooseRepo(repoId?: string): Promise<void>;
  removeRepo(repoId: string): Promise<void>;
  selectRepo(repoId: string, options?: { keepChosenMode?: boolean }): Promise<void>;
  selectWorktree(path: string): Promise<void>;
  selectMode(mode: WorkbenchMode): Promise<void>;
  openPr(prNumber: number): Promise<void>;
}

/**
 * Which surface the window is showing, and everything that changes it.
 *
 * The rule underneath all of it: opening a target decides where the reviewer lands, and
 * the reviewer's own navigation always wins over a load that is still in flight.
 */
export function useWorkbench(store: Store, api: GanderApi): Workbench {
  const activeMode = shallowRef<WorkbenchMode>("explorer");
  const modeBeforeSettings = shallowRef<Exclude<WorkbenchMode, "settings">>("explorer");
  const settingsCategory = shallowRef<SettingsCategory>("workbench");
  const unconfigured = shallowRef(false);

  const surfaceMode = computed(() => (
    activeMode.value === "settings" ? modeBeforeSettings.value : activeMode.value
  ));

  async function refreshConnectionState(): Promise<void> {
    unconfigured.value = (await api.getConnection()).url === "";
    await store.checkService();
  }

  function openSettings(category: SettingsCategory = "workbench"): void {
    if (activeMode.value !== "settings") modeBeforeSettings.value = activeMode.value;
    settingsCategory.value = category;
    activeMode.value = "settings";
  }

  function closeSettings(): void {
    activeMode.value = modeBeforeSettings.value;
    void refreshConnectionState();
  }

  async function onConnected(): Promise<void> {
    await refreshConnectionState();
    await store.loadRepos();
  }

  function landIn(mode: LocalMode, keepChosenMode: boolean): void {
    // The reviewer went somewhere else while the load was in flight: remember where this
    // target landed, so closing Settings returns to it, and leave them where they are.
    if (keepChosenMode && activeMode.value !== "explorer") {
      modeBeforeSettings.value = mode;
      return;
    }
    activeMode.value = mode;
  }

  async function openLocalTarget(
    path: string,
    mode: LocalMode,
    contextError: string | null,
    keepChosenMode = false,
  ): Promise<void> {
    await store.openLocal(path);
    const localError = store.error;
    const errors = [...new Set([contextError, localError].filter((error): error is string => error !== null))];
    store.error = errors.length ? errors.join("\n") : null;
    if (localError) return;
    store.showLocalSurface(mode);
    landIn(mode, keepChosenMode);
  }

  async function openExternalTarget(target: OpenTarget): Promise<void> {
    await store.openTarget(target);
    // A named pull request opens in the review even for a repository with no checkout on
    // this machine: the command named a review, not a folder.
    if (target.prNumber !== null && store.targetRepoId === target.repoId) {
      activeMode.value = "pulls";
      return;
    }
    if (store.targetRepoId !== target.repoId || store.targetWorktreePath === null) {
      activeMode.value = "explorer";
      return;
    }
    if (store.targetWorktreePath) {
      await openLocalTarget(store.targetWorktreePath, "explorer", store.error);
    } else activeMode.value = "pulls";
  }

  /**
   * `keepChosenMode` is for the repository opened at launch: that load finishes long after
   * the window is usable, and it must not drag the reviewer out of a view they opened
   * while it was still working.
   */
  async function selectRepo(repoId: string, { keepChosenMode = false } = {}): Promise<void> {
    await store.selectRepo(repoId);
    const contextError = store.error;
    if (!store.targetWorktreePath) {
      landIn("explorer", keepChosenMode);
      return;
    }
    await openLocalTarget(store.targetWorktreePath, "explorer", contextError, keepChosenMode);
  }

  /** Register a repository from a folder on disk, and open its checkout. `repoId` names the one the reviewer is being asked to locate. */
  async function chooseRepo(repoId?: string): Promise<void> {
    if (!await store.chooseLocalRepo(repoId)) return;
    const contextError = store.error;
    if (!store.targetWorktreePath) {
      activeMode.value = "explorer";
      return;
    }
    await openLocalTarget(store.targetWorktreePath, "explorer", contextError);
  }

  async function removeRepo(repoId: string): Promise<void> {
    await store.removeRepo(repoId);
    activeMode.value = "explorer";
    const next = store.repos[0];
    if (next) await selectRepo(next.repoId);
  }

  async function selectWorktree(path: string): Promise<void> {
    const nextMode = activeMode.value === "changes" ? "changes" : "explorer";
    await store.openLocal(path);
    if (store.error) return;
    store.showLocalSurface(nextMode);
    activeMode.value = nextMode;
  }

  async function selectMode(mode: WorkbenchMode): Promise<void> {
    if (mode === "settings") {
      openSettings();
      return;
    }
    if (mode === "pulls") {
      activeMode.value = "pulls";
      if (store.selectedPrNumber !== null && (store.view?.pr.number !== store.selectedPrNumber || store.currentRepoId !== store.targetRepoId)) {
        await store.openPr(store.selectedPrNumber);
      }
      return;
    }

    activeMode.value = mode;
    const path = store.targetWorktreePath;
    if (!path) return;
    if (store.localView?.worktree.path !== path || store.currentRepoId !== store.targetRepoId) await store.openLocal(path);
    if (!store.error) store.showLocalSurface(mode);
  }

  async function openPr(prNumber: number): Promise<void> {
    activeMode.value = "pulls";
    await store.openPr(prNumber);
  }

  /** What the window opens with: the target named on the command line, or the last repository. */
  async function start(): Promise<void> {
    await refreshConnectionState();
    await store.loadRepos();

    const target = await api.initialTarget();
    if (target !== null) {
      await openExternalTarget(target);
      return;
    }

    const firstRepo = store.repos[0];
    if (firstRepo) await selectRepo(firstRepo.repoId, { keepChosenMode: true });
  }

  // The main process can name a target at any time — at launch, and again whenever
  // `bin/gander` is run against this window.
  let unsubscribeOpenTarget: (() => void) | null = null;
  let unsubscribeOpenSettings: (() => void) | null = null;

  onMounted(async () => {
    unsubscribeOpenTarget = api.onOpenTarget((target) => { void openExternalTarget(target); });
    unsubscribeOpenSettings = api.onOpenSettings(() => openSettings());
    await start();
  });

  onBeforeUnmount(() => {
    unsubscribeOpenTarget?.();
    unsubscribeOpenSettings?.();
  });

  return {
    activeMode,
    surfaceMode,
    settingsCategory,
    unconfigured,
    openSettings,
    closeSettings,
    onConnected,
    openExternalTarget,
    chooseRepo,
    removeRepo,
    selectRepo,
    selectWorktree,
    selectMode,
    openPr,
  };
}
