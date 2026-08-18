<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { api } from "./api.js";
import { createStore } from "./store.js";
import TopBar from "./components/TopBar.vue";
import FileTree from "./components/FileTree.vue";
import DiffPane from "./components/DiffPane.vue";
import QuestionCapture from "./components/QuestionCapture.vue";
import QuestionsDrawer from "./components/QuestionsDrawer.vue";
import StatusBar from "./components/StatusBar.vue";
import Splitter from "./components/Splitter.vue";
import SettingsPane from "./components/SettingsPane.vue";
import { questionsDock, questionsHeight, questionsWidth, treeWidth } from "./layout.js";
import { X } from "lucide-vue-next";
import { createEditorSettingsStore } from "./editor-settings-store.js";
import { effectiveTreeTypography } from "../../settings.js";
import "./theme.css";

const store = createStore(api);
const editorSettings = createEditorSettingsStore(api, api.initialWindowState.colorTheme);
const integratedTitleBar = api.initialWindowState.windowStyle === "integrated-titlebar";
let unsubscribeOpenTarget: (() => void) | null = null;
let unsubscribeOpenSettings: (() => void) | null = null;

onMounted(async () => {
  // Registered first, so commands arriving while the app restores its last review are not dropped.
  unsubscribeOpenTarget = api.onOpenTarget((target) => { void store.openTarget(target); });
  unsubscribeOpenSettings = api.onOpenSettings(() => openSettings());
  void editorSettings.load();
  // An installed app starts with no connection at all. Knowing that here is what lets the
  // window say where to set one instead of showing an empty review that cannot be filled.
  await refreshConnectionState();
  await store.loadRepos();
  const target = await api.initialTarget();
  if (target !== null) await store.openTarget(target);
  else await store.restoreLastReview();
});

const unconfigured = ref(false);
const capturing = ref(false);
const drawerOpen = ref(false);
const treeVisible = ref(true);
const treeScrolling = shallowRef(false);
let treeScrollTimer: ReturnType<typeof setTimeout> | undefined;
const activeSurface = shallowRef<"review" | "settings">("review");
const treeTypography = computed(() => effectiveTreeTypography(editorSettings.settings));
// Which section the settings surface opens on. The prompt about a missing service leads
// straight to the one that fixes it, rather than to whatever was showing last.
const settingsCategory = shallowRef<"workbench" | "editor" | "connection">("workbench");

// A connection just saved is worth checking now: the status bar's poll is 30 seconds
// away, and until it runs the window contradicts what the settings pane just said.
async function onConnected(): Promise<void> {
  await refreshConnectionState();
  await store.loadRepos();
}

async function refreshConnectionState(): Promise<void> {
  unconfigured.value = (await api.getConnection()).url === "";
  await store.checkService();
}

function openSettings(category: "workbench" | "editor" | "connection" = "workbench"): void {
  settingsCategory.value = category;
  activeSurface.value = "settings";
}

function closeSettings(): void {
  activeSurface.value = "review";
  void refreshConnectionState();
}

function toggleSettings(): void {
  activeSurface.value = activeSurface.value === "settings" ? "review" : "settings";
  // Read back on the way out as well as on the save: the review surface must never
  // claim there is no service while the status bar says it is connected.
  if (activeSurface.value === "review") void refreshConnectionState();
}

// v-model needs something assignable, and which dimension the questions splitter drags
// depends on where the panel is docked.
const questionsSize = computed({
  get: () => (questionsDock.value === "right" ? questionsWidth.value : questionsHeight.value),
  set: (value: number) => {
    if (questionsDock.value === "right") questionsWidth.value = value;
    else questionsHeight.value = value;
  },
});
const questionCount = computed(() => store.view?.questions.length ?? 0);

function onTreeScroll(): void {
  treeScrolling.value = true;
  clearTimeout(treeScrollTimer);
  treeScrollTimer = setTimeout(() => { treeScrolling.value = false; }, 500);
}

// Monaco takes keyboard input through a hidden textarea, so clicking a line to position
// the cursor makes the diff the focused "text field" — and a naive typing check hands it
// every keystroke, including the one that opens capture. Every editor in this app is
// read-only, so a key pressed inside one is never being typed into anything.
function isTyping(target: HTMLElement | null): boolean {
  if (target === null) return false;
  if (target.closest("[data-app-typing='true']") !== null) return true;
  if (target.closest(".monaco-editor") !== null) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function onKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  if (isTyping(target)) return;
  if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
    // Same shortcut VS Code uses for its side bar.
    e.preventDefault();
    e.stopPropagation();
    treeVisible.value = !treeVisible.value;
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n" && store.view) {
    e.preventDefault();
    // Monaco would otherwise still handle it and flash "Cannot edit in read-only editor".
    e.stopPropagation();
    capturing.value = true;
  }
}
window.addEventListener("keydown", onKey, true);

const POLL_MS = 30_000;
let refreshing = false;
async function refreshOnce(): Promise<void> {
  if (refreshing || !store.view) return;
  refreshing = true;
  try {
    await store.refresh();
  } finally {
    refreshing = false;
  }
}
const timer = setInterval(() => void refreshOnce(), POLL_MS);
// The health dot is the only live signal when no pull request is open, and the window
// can sit unfocused for hours — so it gets its own timer rather than riding on the
// refresh poll, which returns early with nothing open and only wakes on focus.
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
});
</script>

<template>
  <div class="app">
    <TopBar
      :store="store"
      :questions="questionCount"
      :settings-active="activeSurface === 'settings'"
      :integrated-title-bar="integratedTitleBar"
      @toggle-questions="drawerOpen = !drawerOpen"
      @toggle-settings="toggleSettings"
    />
    <div v-if="store.error" class="error-banner">
      <span>{{ store.error }}</span>
      <button aria-label="Dismiss" title="Dismiss" @click="store.dismissError()"><X :size="14" /></button>
    </div>
    <main class="body">
      <SettingsPane
        v-if="activeSurface === 'settings'"
        :store="editorSettings"
        :initial-category="settingsCategory"
        @connected="onConnected"
        @close="closeSettings"
      />
      <div v-show="activeSurface === 'review'" class="review-surface">
        <p v-if="store.busy && !store.view" class="empty working">
          <span class="spinner" />Opening pull request…
        </p>
        <p v-else-if="unconfigured" class="empty">
          No review service yet.
          <button class="link" type="button" @click="openSettings('connection')">Set its URL and token</button>
          to start reviewing.
        </p>
        <p v-else-if="!store.view" class="empty">Pick a repository, then a pull request.</p>
        <template v-else>
          <FileTree
            v-if="treeVisible"
            :store="store"
            :icon-theme="editorSettings.settings.workbench.iconTheme"
            :typography="treeTypography"
            class="tree"
            :class="{ scrolling: treeScrolling }"
            :style="{ width: `${treeWidth}px` }"
            @scroll.passive="onTreeScroll"
          />
          <Splitter
            v-if="treeVisible"
            v-model="treeWidth"
            orientation="vertical"
            :min="160"
            :max="600"
          />
          <!-- Docked right, questions sit beside the diff; docked bottom, under both the
               diff and the tree, which is what gives the diff the full window width. -->
          <div class="workspace" :class="questionsDock">
            <DiffPane :store="store" :editor-settings="editorSettings.settings.editor" class="diff" />
            <template v-if="drawerOpen">
              <Splitter
                v-model="questionsSize"
                :orientation="questionsDock === 'right' ? 'vertical' : 'horizontal'"
                :min="questionsDock === 'right' ? 220 : 120"
                :max="700"
                inverted
              />
              <QuestionsDrawer
                :store="store"
                class="drawer"
                :dock="questionsDock"
                @dock="questionsDock = $event"
                :style="questionsDock === 'right'
                  ? { width: `${questionsWidth}px` }
                  : { height: `${questionsHeight}px` }"
                @close="drawerOpen = false"
              />
            </template>
          </div>
        </template>
      </div>
    </main>
    <StatusBar :store="store" :tree-visible="treeVisible" @toggle-tree="treeVisible = !treeVisible" />
    <QuestionCapture :store="store" :open="capturing" @close="capturing = false" />
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: 50px 1fr auto; height: 100vh; }
.error-banner { display: flex; align-items: center; gap: 10px; background: var(--danger-background); color: var(--danger); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--workbench-border); }
.error-banner span { flex: 1; }
.error-banner button { background: none; border: none; color: inherit; cursor: pointer; display: flex; flex: none; }
.empty { color: var(--faint-foreground); padding: 2rem; }
.empty .link { border: 0; padding: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
.working { display: flex; align-items: center; gap: 10px; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--workbench-border); border-top-color: var(--faint-foreground);
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
/* Flex rather than grid: panel sizes are dragged, so they are inline styles on the panels
   themselves and the container only has to decide direction. */
.body { display: flex; min-height: 0; }
.review-surface { flex: 1; display: flex; min-width: 0; min-height: 0; }
.workspace { flex: 1; display: flex; min-width: 0; min-height: 0; }
.workspace.right { flex-direction: row; }
.workspace.bottom { flex-direction: column; }
.drawer { flex: none; }
.workspace.bottom .drawer { border-left: none; border-top: 1px solid var(--workbench-border); }
.tree {
  --scrollbar-thumb: transparent;
  --scrollbar-track: transparent;
  flex: none;
  border-right: 1px solid var(--workbench-border);
  overflow: hidden auto;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  transition: scrollbar-color 120ms cubic-bezier(0.16, 1, 0.3, 1);
}
.tree:hover, .tree:focus-within, .tree.scrolling {
  --scrollbar-thumb: color-mix(in srgb, var(--faint-foreground) 45%, transparent);
  --scrollbar-track: transparent;
}
.diff { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .tree { transition: none; } }
@media (prefers-contrast: more) {
  .tree:hover, .tree:focus-within, .tree.scrolling { --scrollbar-thumb: var(--workbench-foreground); }
}
@media (forced-colors: active) { .tree { scrollbar-color: auto; } }
</style>
