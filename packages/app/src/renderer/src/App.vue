<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { OpenTarget } from "@gander/shared";
import { MessageSquare, Plus, RefreshCw, X } from "lucide-vue-next";
import { api } from "./api.js";
import { createStore } from "./store.js";
import { createEditorSettingsStore } from "./editor-settings-store.js";
import { questionsDock, questionsHeight, questionsWidth, treeWidth } from "./layout.js";
import { effectiveTreeTypography } from "../../settings.js";
import { currentLine } from "./selection.js";
import type { QuestionTarget } from "./selection.js";
import { DEFAULT_ZOOM_LEVEL, clampZoomLevel } from "../../zoom.js";
import ActivityRail from "./components/ActivityRail.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import DiffPane from "./components/DiffPane.vue";
import FullFilePane from "./components/FullFilePane.vue";
import LocalSidebar from "./components/LocalSidebar.vue";
import PullRequestSidebar from "./components/PullRequestSidebar.vue";
import QuestionCapture from "./components/QuestionCapture.vue";
import QuestionsDrawer from "./components/QuestionsDrawer.vue";
import SettingsPane from "./components/SettingsPane.vue";
import Splitter from "./components/Splitter.vue";
import StackPosition from "./components/StackPosition.vue";
import StatusBar from "./components/StatusBar.vue";
import TargetBar from "./components/TargetBar.vue";
import "./theme.css";

type WorkbenchMode = "explorer" | "changes" | "pulls" | "settings";

const store = createStore(api);
const editorSettings = createEditorSettingsStore(api, api.initialWindowState.colorTheme);
const integratedTitleBar = api.initialWindowState.windowStyle === "integrated-titlebar";
const activeMode = shallowRef<WorkbenchMode>("explorer");
const modeBeforeSettings = shallowRef<Exclude<WorkbenchMode, "settings">>("explorer");
const unconfigured = ref(false);
const questionTarget = shallowRef<QuestionTarget | null>(null);
const drawerOpen = ref(false);
const treeVisible = ref(true);
const treeScrolling = shallowRef(false);
const zoomLevel = shallowRef(DEFAULT_ZOOM_LEVEL);
const settingsCategory = shallowRef<"workbench" | "editor" | "connection">("workbench");
const repoPendingRemoval = ref<string | null>(null);
let unsubscribeOpenTarget: (() => void) | null = null;
let unsubscribeOpenSettings: (() => void) | null = null;
let unsubscribeZoomChanged: (() => void) | null = null;
let treeScrollTimer: ReturnType<typeof setTimeout> | undefined;

const treeTypography = computed(() => effectiveTreeTypography(editorSettings.settings));
const questionCount = computed(() => store.view?.questions.length ?? 0);
const hasLoadedView = computed(() => store.view !== null || store.localView !== null);
const questionsSize = computed({
  get: () => (questionsDock.value === "right" ? questionsWidth.value : questionsHeight.value),
  set: (value: number) => {
    if (questionsDock.value === "right") questionsWidth.value = value;
    else questionsHeight.value = value;
  },
});

onMounted(async () => {
  unsubscribeOpenTarget = api.onOpenTarget((target) => { void openExternalTarget(target); });
  unsubscribeOpenSettings = api.onOpenSettings(() => openSettings());
  unsubscribeZoomChanged = api.onZoomChanged((level) => { zoomLevel.value = level; });
  zoomLevel.value = await api.getZoomLevel();
  void editorSettings.load();
  await refreshConnectionState();
  await store.loadRepos();

  const target = await api.initialTarget();
  if (target !== null) {
    await openExternalTarget(target);
    return;
  }

  const firstRepo = store.repos[0];
  if (firstRepo) await selectTargetRepo(firstRepo.repoId, { keepChosenMode: true });
});

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

async function onConnected(): Promise<void> {
  await refreshConnectionState();
  await store.loadRepos();
}

async function refreshConnectionState(): Promise<void> {
  unconfigured.value = (await api.getConnection()).url === "";
  await store.checkService();
}

function openSettings(category: "workbench" | "editor" | "connection" = "workbench"): void {
  if (activeMode.value !== "settings") modeBeforeSettings.value = activeMode.value;
  settingsCategory.value = category;
  activeMode.value = "settings";
}

function closeSettings(): void {
  activeMode.value = modeBeforeSettings.value;
  void refreshConnectionState();
}

async function changeZoom(level: number): Promise<void> {
  zoomLevel.value = clampZoomLevel(level);
  zoomLevel.value = await api.setZoomLevel(level);
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

async function removeRepo(): Promise<void> {
  const repoId = repoPendingRemoval.value;
  repoPendingRemoval.value = null;
  if (repoId === null) return;
  await store.removeRepo(repoId);
  activeMode.value = "explorer";
  const next = store.repos[0];
  if (next) await selectTargetRepo(next.repoId);
}

/**
 * `keepChosenMode` is for the repository opened at launch: that load finishes long after
 * the window is usable, and it must not drag the reviewer out of a view they opened
 * while it was still working.
 */
async function selectTargetRepo(repoId: string, { keepChosenMode = false } = {}): Promise<void> {
  await store.selectRepo(repoId);
  const contextError = store.error;
  if (!store.targetWorktreePath) {
    landIn("explorer", keepChosenMode);
    return;
  }
  await openLocalTarget(store.targetWorktreePath, "explorer", contextError, keepChosenMode);
}

/**
 * Settings covers the work surface instead of replacing it: rebuilding the editor every
 * time the reviewer checks a setting is the cost this avoids.
 */
const surfaceMode = computed(() => (activeMode.value === "settings" ? modeBeforeSettings.value : activeMode.value));

function landIn(mode: "explorer" | "changes", keepChosenMode: boolean): void {
  // The reviewer went somewhere else while the load was in flight: remember where this
  // target landed, so closing Settings returns to it, and leave them where they are.
  if (keepChosenMode && activeMode.value !== "explorer") {
    modeBeforeSettings.value = mode;
    return;
  }
  activeMode.value = mode;
}

async function selectTargetWorktree(path: string): Promise<void> {
  const nextMode = activeMode.value === "changes" ? "changes" : "explorer";
  await store.openLocal(path);
  if (store.error) return;
  store.showLocalSurface(nextMode);
  activeMode.value = nextMode;
}

async function openLocalTarget(
  path: string,
  mode: "explorer" | "changes",
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

async function selectMode(value: WorkbenchMode): Promise<void> {
  if (value === "settings") {
    openSettings();
    return;
  }
  if (value === "pulls") {
    activeMode.value = "pulls";
    if (store.selectedPrNumber !== null && (store.view?.pr.number !== store.selectedPrNumber || store.currentRepoId !== store.targetRepoId)) {
      await store.openPr(store.selectedPrNumber);
    }
    return;
  }

  activeMode.value = value;
  const path = store.targetWorktreePath;
  if (!path) return;
  if (store.localView?.worktree.path !== path || store.currentRepoId !== store.targetRepoId) await store.openLocal(path);
  if (!store.error) store.showLocalSurface(value);
}

async function openPr(prNumber: number): Promise<void> {
  activeMode.value = "pulls";
  await store.openPr(prNumber);
}

watch(activeMode, (mode) => {
  if (mode !== "pulls") {
    drawerOpen.value = false;
    questionTarget.value = null;
  }
});

function openQuestion(target?: QuestionTarget): void {
  if (!store.view || activeMode.value !== "pulls") return;
  questionTarget.value = target ?? {
    path: store.selectedPath,
    line: store.selectedPath === null ? null : currentLine.value,
  };
}

function onTreeScroll(): void {
  treeScrolling.value = true;
  clearTimeout(treeScrollTimer);
  treeScrollTimer = setTimeout(() => { treeScrolling.value = false; }, 500);
}

function isTyping(target: HTMLElement | null): boolean {
  if (target === null) return false;
  if (target.closest("[data-app-typing='true']") !== null) return true;
  if (target.closest(".monaco-editor") !== null) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (isTyping(target)) return;
  if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    event.stopPropagation();
    treeVisible.value = !treeVisible.value;
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "n" && store.view && activeMode.value === "pulls") {
    event.preventDefault();
    event.stopPropagation();
    openQuestion();
  }
}
window.addEventListener("keydown", onKey, true);

const POLL_MS = 30_000;
let refreshing = false;
async function refreshOnce(): Promise<void> {
  if (refreshing || !hasLoadedView.value) return;
  refreshing = true;
  try { await store.refresh(); } finally { refreshing = false; }
}
const timer = setInterval(() => void refreshOnce(), POLL_MS);
const HEALTH_MS = 15_000;
const healthTimer = setInterval(() => void store.checkService(), HEALTH_MS);
const onFocus = (): void => { void store.checkService(); void refreshOnce(); };
window.addEventListener("focus", onFocus);
onBeforeUnmount(() => {
  clearInterval(timer);
  clearInterval(healthTimer);
  clearTimeout(treeScrollTimer);
  window.removeEventListener("focus", onFocus);
  window.removeEventListener("keydown", onKey, true);
  unsubscribeOpenTarget?.();
  unsubscribeOpenSettings?.();
  unsubscribeZoomChanged?.();
});
</script>

<template>
  <div class="app">
    <div class="top-stack">
      <TargetBar
        :store="store"
        :integrated-title-bar="integratedTitleBar"
        @select-repo="selectTargetRepo"
        @select-worktree="selectTargetWorktree"
        @open-folder="chooseRepo()"
        @locate-repo="chooseRepo($event)"
        @remove-repo="repoPendingRemoval = $event"
      />
      <div v-if="store.error" class="error-banner">
        <span>{{ store.error }}</span>
        <button aria-label="Dismiss" title="Dismiss" @click="store.dismissError()"><X :size="14" /></button>
      </div>
    </div>
    <main class="body">
      <ActivityRail
        :active="activeMode"
        :has-target="store.targetWorktreePath !== null"
        @select="selectMode"
      />

      <div
        v-if="treeVisible && activeMode !== 'settings'"
        class="view-sidebar"
        :class="{ scrolling: treeScrolling }"
        :style="{ width: `${treeWidth}px` }"
      >
        <LocalSidebar
          v-if="activeMode === 'explorer' || activeMode === 'changes'"
          :store="store"
          :mode="activeMode"
          :icon-theme="editorSettings.settings.workbench.iconTheme"
          :typography="treeTypography"
          @scroll="onTreeScroll"
        />
        <PullRequestSidebar
          v-else
          :store="store"
          :icon-theme="editorSettings.settings.workbench.iconTheme"
          :typography="treeTypography"
          @select-pr="openPr"
          @scroll="onTreeScroll"
        />
      </div>
      <Splitter v-if="treeVisible && activeMode !== 'settings'" v-model="treeWidth" orientation="vertical" :min="190" :max="520" />

      <div class="content">
        <SettingsPane
          v-if="activeMode === 'settings'"
          :store="editorSettings"
          :initial-category="settingsCategory"
          @connected="onConnected"
          @close="closeSettings"
        />

        <template v-if="surfaceMode === 'explorer' || surfaceMode === 'changes'">
          <div v-if="store.localView" class="context-toolbar">
            <div class="context-title">
              <strong>{{ store.currentRepoId?.split('/').at(-1) }}</strong>
              <span>{{ store.localView.worktree.branch ?? store.localView.worktree.headSha.slice(0, 8) }}</span>
            </div>
            <button :disabled="store.busy" aria-label="Refresh local changes" title="Refresh local changes" @click="store.fetchNow()"><RefreshCw :size="15" :class="{ spin: store.busy }" /></button>
            <span class="progress local-progress">{{ store.localView.files.length }} changed</span>
          </div>
          <section class="work-surface">
            <p v-if="store.busy && !store.localView" class="empty working"><span class="spinner" />Opening worktree…</p>
            <div v-else-if="!store.targetRepoId" class="welcome">
              <h1>Open a repository from disk</h1>
              <p>Gander will discover its linked worktrees and pull requests from one local checkout.</p>
              <button type="button" @click="chooseRepo()">Open repository folder…</button>
              <button v-if="unconfigured" class="text-action" type="button" @click="openSettings('connection')">Connect a review service for pull requests</button>
            </div>
            <div v-else-if="!store.targetWorktreePath" class="empty-state">
              <h1>Checkout unavailable</h1>
              <p>Gander cannot read the registered checkout for this repository.</p>
              <button type="button" @click="store.targetRepoId && chooseRepo(store.targetRepoId)">Locate checkout…</button>
            </div>
            <div v-else-if="!store.localView" class="empty">Select the target again to load this worktree.</div>
            <FullFilePane v-else-if="surfaceMode === 'explorer'" :file="store.localFile" :editor-settings="editorSettings.settings.editor" class="diff" />
            <DiffPane v-else :store="store" :editor-settings="editorSettings.settings.editor" class="diff" />
          </section>
        </template>

        <template v-else>
          <div v-if="store.view && store.currentRepoId === store.targetRepoId" class="context-toolbar">
            <div class="context-title">
              <strong>{{ store.currentRepoId?.split('/').at(-1) }}</strong>
              <span><StackPosition v-if="store.view.pr.stack" class="header-stack-position" :position="store.view.pr.stack.position" :size="store.view.pr.stack.size" /> #{{ store.view.pr.number }} {{ store.view.pr.title }}</span>
            </div>
            <button aria-label="Add question (N)" title="Add question (N)" @click="openQuestion()"><Plus :size="14" /> Question</button>
            <button aria-label="Questions" :title="`Questions (${questionCount})`" @click="drawerOpen = !drawerOpen"><MessageSquare :size="15" /><span v-if="questionCount">{{ questionCount }}</span></button>
            <button :disabled="store.busy" aria-label="Fetch origin" title="Fetch origin" @click="store.fetchNow()"><RefreshCw :size="15" :class="{ spin: store.busy }" /></button>
            <span class="progress">{{ store.progress().done }}/{{ store.progress().total }} reviewed</span>
          </div>
          <section class="work-surface">
            <p v-if="store.busy && !store.view" class="empty working"><span class="spinner" />Opening pull request…</p>
            <div v-else-if="!store.targetRepoId" class="welcome">
              <h1>Open a repository from disk</h1>
              <p>Pull requests belong to the repository you choose as your target.</p>
              <button type="button" @click="chooseRepo()">Open repository folder…</button>
            </div>
            <div v-else-if="!store.view || store.currentRepoId !== store.targetRepoId" class="empty-state">
              <h1>Select a pull request</h1>
              <p>Choose a pull request or stack from the sidebar to begin reviewing.</p>
            </div>
            <div v-else class="workspace" :class="questionsDock">
              <DiffPane :store="store" :editor-settings="editorSettings.settings.editor" class="diff" @add-question="openQuestion" />
              <template v-if="drawerOpen">
                <Splitter v-model="questionsSize" :orientation="questionsDock === 'right' ? 'vertical' : 'horizontal'" :min="questionsDock === 'right' ? 220 : 120" :max="700" inverted />
                <QuestionsDrawer
                  :store="store"
                  class="drawer"
                  :dock="questionsDock"
                  :style="questionsDock === 'right' ? { width: `${questionsWidth}px` } : { height: `${questionsHeight}px` }"
                  @dock="questionsDock = $event"
                  @close="drawerOpen = false"
                  @add-question="openQuestion()"
                />
              </template>
            </div>
          </section>
        </template>
      </div>
    </main>
    <StatusBar
      :store="store"
      :tree-visible="treeVisible"
      :is-development="api.initialWindowState.isDevelopment"
      :worktree-label="api.initialWindowState.worktreeLabel"
      :zoom-level="zoomLevel"
      @toggle-tree="treeVisible = !treeVisible"
      @change-zoom="changeZoom"
      @open-zoom-settings="openSettings('workbench')"
    />
    <QuestionCapture :store="store" :target="questionTarget" @close="questionTarget = null" />
    <ConfirmDialog
      :open="repoPendingRemoval !== null"
      title="Remove repository?"
      detail="This removes the repository from Gander. It does not delete any checkout or worktree from disk."
      confirm-label="Remove repository"
      @confirm="removeRepo"
      @cancel="repoPendingRemoval = null"
    />
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
.top-stack { min-width: 0; }
.error-banner { display: flex; align-items: center; gap: 10px; background: var(--danger-background); color: var(--danger); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--workbench-border); }
.error-banner span { flex: 1; }
.error-banner button { flex: none; display: flex; border: 0; background: none; color: inherit; cursor: pointer; }
.body { display: flex; min-height: 0; }
.content { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.content > .settings-pane { position: absolute; inset: 0; z-index: 5; background: var(--workbench-background); }
.view-sidebar { --scrollbar-thumb: transparent; --scrollbar-track: transparent; flex: none; min-height: 0; border-right: 1px solid var(--workbench-border); scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track); scrollbar-width: thin; transition: scrollbar-color 120ms cubic-bezier(0.16, 1, 0.3, 1); }
.view-sidebar:hover, .view-sidebar:focus-within, .view-sidebar.scrolling { --scrollbar-thumb: color-mix(in srgb, var(--faint-foreground) 45%, transparent); }
.context-toolbar { height: 35px; flex: none; display: flex; align-items: center; gap: 6px; padding-inline: 12px 7px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); }
.context-title { min-width: 0; display: flex; align-items: baseline; gap: 7px; margin-right: auto; }
.context-title strong { font-size: 12px; }
.context-title span { min-width: 0; display: flex; align-items: center; gap: 5px; color: var(--muted-foreground); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.context-toolbar button { min-height: 26px; display: flex; align-items: center; gap: 5px; padding: 3px 8px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--elevated-background); color: var(--muted-foreground); font: inherit; cursor: pointer; }
.context-toolbar button:hover { color: var(--workbench-foreground); border-color: var(--faint-foreground); }
.context-toolbar button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.context-toolbar button:disabled { opacity: .55; cursor: default; }
.progress { padding-inline: 4px; color: var(--faint-foreground); font-size: 11px; white-space: nowrap; }
.work-surface { flex: 1; min-width: 0; min-height: 0; display: flex; background: var(--workbench-background); }
.workspace { flex: 1; display: flex; min-width: 0; min-height: 0; }
.workspace.right { flex-direction: row; }
.workspace.bottom { flex-direction: column; }
.drawer { flex: none; }
.workspace.bottom .drawer { border-left: none; border-top: 1px solid var(--workbench-border); }
.diff { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.empty { margin: auto; color: var(--faint-foreground); padding: 2rem; }
.working { display: flex; align-items: center; gap: 10px; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--workbench-border); border-top-color: var(--faint-foreground); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.welcome, .empty-state { margin: auto; max-width: 460px; padding: 40px; text-align: center; color: var(--muted-foreground); }
.welcome h1, .empty-state h1 { margin: 0 0 10px; color: var(--workbench-foreground); font-size: 22px; letter-spacing: -.02em; }
.welcome p, .empty-state p { margin: 0 0 22px; line-height: 1.55; }
.welcome button, .empty-state button { min-height: 32px; padding: 6px 13px; border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--accent-foreground); font: inherit; cursor: pointer; }
.welcome .text-action { display: block; margin: 14px auto 0; border: 0; background: none; color: var(--accent); }
.welcome button:focus-visible, .empty-state button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } .view-sidebar { transition: none; } }
@media (prefers-contrast: more) { .view-sidebar:hover, .view-sidebar:focus-within, .view-sidebar.scrolling { --scrollbar-thumb: var(--workbench-foreground); } }
@media (forced-colors: active) { .view-sidebar { scrollbar-color: auto; } }
</style>
