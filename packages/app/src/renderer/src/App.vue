<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { X } from "@lucide/vue";
import { api } from "./api.js";
import { createStore } from "./store.js";
import { createEditorSettingsStore } from "./editor-settings-store.js";
import { effectiveTreeTypography } from "../../settings.js";
import { basename } from "./paths.js";
import { currentLine } from "./selection.js";
import type { NoteTarget } from "./selection.js";
import { useWorkbench } from "./composables/use-workbench.js";
import { useReviewKeyboard } from "./composables/use-review-keyboard.js";
import { useWindowZoom } from "./composables/use-window-zoom.js";
import { useBackgroundRefresh } from "./composables/use-background-refresh.js";
import ActivityRail from "./components/ActivityRail.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import KeymapHelp from "./components/KeymapHelp.vue";
import LocalSurface from "./components/LocalSurface.vue";
import NoteCapture from "./components/NoteCapture.vue";
import ReviewSurface from "./components/ReviewSurface.vue";
import SettingsPane from "./components/SettingsPane.vue";
import StatusBar from "./components/StatusBar.vue";
import TargetBar from "./components/TargetBar.vue";
import WorkbenchSidebar from "./components/WorkbenchSidebar.vue";

const store = createStore(api);
const editorSettings = createEditorSettingsStore(api, api.initialWindowState.colorTheme);
const {
  activeMode, surfaceMode, settingsCategory, unconfigured,
  openSettings, closeSettings, onConnected,
  chooseRepo, removeRepo, selectRepo, selectWorktree, selectMode, openPr,
} = useWorkbench(store, api);
const { level: zoomLevel, change: changeZoom } = useWindowZoom(api);
const integratedTitleBar = api.initialWindowState.windowStyle === "integrated-titlebar";

const noteTarget = shallowRef<NoteTarget | null>(null);
const drawerOpen = ref(false);
const treeVisible = ref(true);
const helpOpen = ref(false);
const repoPendingRemoval = ref<string | null>(null);
const reviewSurface = ref<InstanceType<typeof ReviewSurface> | null>(null);

const treeTypography = computed(() => effectiveTreeTypography(editorSettings.settings));
const repoName = computed(() => store.currentRepoId === null ? "" : basename(store.currentRepoId));

const treeJump = useReviewKeyboard({
  store,
  mode: () => activeMode.value,
  treeVisible,
  drawerOpen,
  helpOpen,
  diff: () => reviewSurface.value,
  captureNote: () => openNote(),
});

useBackgroundRefresh(store, () => store.view !== null || store.localView !== null);

onMounted(() => { void editorSettings.load(); });

// The notes belong to the pull request being reviewed, so leaving it puts them away.
watch(activeMode, (mode) => {
  if (mode === "pulls") return;
  drawerOpen.value = false;
  noteTarget.value = null;
});

/** Opens the note editor. Without a target, the note lands on wherever the reviewer is. */
function openNote(target?: NoteTarget): void {
  if (!store.view || activeMode.value !== "pulls") return;
  noteTarget.value = target ?? {
    path: store.selectedPath,
    line: store.selectedPath === null ? null : currentLine.value,
  };
}

async function confirmRemoveRepo(): Promise<void> {
  const repoId = repoPendingRemoval.value;
  repoPendingRemoval.value = null;
  if (repoId !== null) await removeRepo(repoId);
}
</script>

<template>
  <div class="app">
    <div class="top-stack">
      <TargetBar
        :store="store"
        :integrated-title-bar="integratedTitleBar"
        @select-repo="selectRepo($event)"
        @select-worktree="selectWorktree"
        @select-pr="openPr"
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

      <WorkbenchSidebar
        v-if="treeVisible && activeMode !== 'settings'"
        :store="store"
        :mode="surfaceMode"
        :icon-theme="editorSettings.settings.workbench.iconTheme"
        :typography="treeTypography"
        :jump-targets="treeJump.targetsByPath.value"
        @select-pr="openPr"
      />

      <div class="content">
        <SettingsPane
          v-if="activeMode === 'settings'"
          :store="editorSettings"
          :initial-category="settingsCategory"
          @connected="onConnected"
          @close="closeSettings"
        />

        <LocalSurface
          v-if="surfaceMode !== 'pulls'"
          :store="store"
          :editor-settings="editorSettings.settings.editor"
          :mode="surfaceMode"
          :repo-name="repoName"
          :unconfigured="unconfigured"
          @choose-repo="chooseRepo($event)"
          @connect-service="openSettings('connection')"
        />
        <ReviewSurface
          v-else
          ref="reviewSurface"
          v-model:drawer-open="drawerOpen"
          :store="store"
          :editor-settings="editorSettings.settings.editor"
          :repo-name="repoName"
          @choose-repo="chooseRepo()"
          @add-note="openNote"
        />
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
    <NoteCapture :store="store" :target="noteTarget" @close="noteTarget = null" />
    <KeymapHelp v-if="helpOpen" @close="helpOpen = false" />
    <ConfirmDialog
      :open="repoPendingRemoval !== null"
      title="Remove repository?"
      detail="This removes the repository from Gander. It does not delete any checkout or worktree from disk."
      confirm-label="Remove repository"
      @confirm="confirmRemoveRepo"
      @cancel="repoPendingRemoval = null"
    />
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: auto 1fr auto; height: 100%; }
.top-stack { min-width: 0; }
.error-banner { display: flex; align-items: center; gap: 10px; background: var(--danger-background); color: var(--danger); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--workbench-border); }
.error-banner span { flex: 1; }
.error-banner button { flex: none; display: flex; border: 0; background: none; color: inherit; cursor: pointer; }
.body { display: flex; min-height: 0; }
.content { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.content > .settings-pane { position: absolute; inset: 0; z-index: 5; background: var(--workbench-background); }
</style>
