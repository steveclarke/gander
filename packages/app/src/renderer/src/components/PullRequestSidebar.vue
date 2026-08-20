<script setup lang="ts">
import { computed, ref } from "vue";
import { RefreshCw } from "@lucide/vue";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import type { Store } from "../store.js";
import FileTree from "./FileTree.vue";
import ReviewFilesToolbar from "./ReviewFilesToolbar.vue";
import ReviewingList from "./ReviewingList.vue";
import type { JumpTarget } from "../tree-jump.js";
import {
  allDirectoriesCollapsed,
  remainingOnly,
  reviewTreeFiles,
  toggleAllDirectories,
} from "../tree-nav.js";

const props = defineProps<{
  store: Store;
  iconTheme: FileIconThemeId;
  typography: EffectiveTreeTypography;
  jumpTargets?: ReadonlyMap<string, JumpTarget>;
}>();
defineEmits<{ selectPr: [prNumber: number]; scroll: [] }>();

const reloading = ref(false);
const remainingCount = computed(() => props.store.view?.files.filter((file) => !file.checked).length ?? 0);
const totalFileCount = computed(() => props.store.view?.files.length ?? 0);
const reviewProgressDescription = computed(() =>
  `${remainingCount.value} of ${totalFileCount.value} ${totalFileCount.value === 1 ? "file" : "files"} unchecked`);
const hasDirectories = computed(() => reviewTreeFiles(props.store.view?.files ?? []).some((file) => file.path.includes("/")));
const foldersCollapsed = computed(() => allDirectoriesCollapsed(props.store.view?.files ?? []));

async function reload(): Promise<void> {
  reloading.value = true;
  try {
    await props.store.refreshPrs();
  } finally {
    reloading.value = false;
  }
}
</script>

<template>
  <aside class="pull-sidebar" :class="{ 'has-review': store.view && store.currentRepoId === store.targetRepoId }" aria-label="Pull Requests">
    <section class="pull-section">
      <header>
        <h1>Pull Requests</h1>
        <span>{{ store.prs.length }}</span>
        <button
          type="button"
          class="reload"
          :disabled="reloading || store.targetRepoId === null"
          aria-label="Refresh pull requests"
          title="Refresh pull requests"
          @click="reload"
        ><RefreshCw :size="13" :class="{ spin: reloading }" /></button>
      </header>
      <ReviewingList
        v-if="store.prs.length"
        :prs="store.prs"
        :selected-pr-number="store.selectedPrNumber"
        @select="$emit('selectPr', $event)"
      />
      <p v-else class="empty">No open pull requests.</p>
    </section>
    <section v-if="store.view && store.currentRepoId === store.targetRepoId" class="files-section">
      <header>
        <h2>Review Files</h2>
        <span
          class="review-progress"
          :title="reviewProgressDescription"
          :aria-label="reviewProgressDescription"
        >{{ remainingCount }}/{{ totalFileCount }} unchecked</span>
        <ReviewFilesToolbar
          :remaining-only="remainingOnly"
          :has-directories="hasDirectories"
          :all-directories-collapsed="foldersCollapsed"
          @toggle-all="toggleAllDirectories(store.view.files)"
          @toggle-remaining="remainingOnly = !remainingOnly"
        />
      </header>
      <FileTree
        v-if="!remainingOnly || remainingCount > 0"
        :store="store"
        :icon-theme="iconTheme"
        :typography="typography"
        :jump-targets="jumpTargets"
        @scroll.passive="$emit('scroll')"
      />
      <p v-else class="remaining-empty">All files reviewed.</p>
    </section>
  </aside>
</template>

<style scoped>
.pull-sidebar { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--panel-background); }
.pull-section { flex: 1; min-height: 100px; overflow: auto; }
.has-review .pull-section { flex: 0 1 auto; max-height: 48%; border-bottom: 1px solid var(--workbench-border); }
.files-section { flex: 1; min-height: 120px; display: flex; flex-direction: column; }
header { position: sticky; inset-block-start: 0; z-index: 1; height: 35px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding-inline: 12px; background: var(--panel-background); border-bottom: 1px solid var(--workbench-border); }
h1, h2 { margin: 0; color: var(--muted-foreground); font-size: 10px; font-weight: 700; letter-spacing: .55px; text-transform: uppercase; }
header span { margin-left: auto; color: var(--faint-foreground); font: 10px var(--mono); }
.reload { display: flex; padding: 2px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--faint-foreground); cursor: pointer; }
.reload:hover:not(:disabled) { color: var(--workbench-foreground); background: var(--elevated-background); }
.reload:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.reload:disabled { opacity: .5; cursor: default; }
.empty { margin: 0; padding: 12px; color: var(--faint-foreground); font-size: 11px; }
.remaining-empty { margin: 0; padding: 16px 12px; color: var(--muted-foreground); font-size: 11px; text-align: center; }
.files-section :deep(.tree.root) { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.pull-sidebar :deep(.reviewing-list) { padding: 5px 0 8px; }
</style>
