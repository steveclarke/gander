<script setup lang="ts">
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import type { Store } from "../store.js";
import FileTree from "./FileTree.vue";
import ReviewingList from "./ReviewingList.vue";

defineProps<{ store: Store; iconTheme: FileIconThemeId; typography: EffectiveTreeTypography }>();
defineEmits<{ selectPr: [prNumber: number]; scroll: [] }>();
</script>

<template>
  <aside class="pull-sidebar" :class="{ 'has-review': store.view && store.currentRepoId === store.targetRepoId }" aria-label="Pull Requests">
    <section class="pull-section">
      <header>
        <h1>Pull Requests</h1>
        <span>{{ store.prs.length }}</span>
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
        <span>{{ store.view.files.length }}</span>
      </header>
      <FileTree
        :store="store"
        :icon-theme="iconTheme"
        :typography="typography"
        @scroll.passive="$emit('scroll')"
      />
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
.empty { margin: 0; padding: 12px; color: var(--faint-foreground); font-size: 11px; }
.files-section :deep(.tree.root) { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.pull-sidebar :deep(.reviewing-list) { padding: 5px 0 8px; }
</style>
