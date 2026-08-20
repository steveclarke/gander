<script setup lang="ts">
import { computed } from "vue";
import { Ellipsis, FolderCheck, ListChevronsDownUp, ListChevronsUpDown, ListFilter } from "@lucide/vue";

const props = defineProps<{
  remainingOnly: boolean;
  hasDirectories: boolean;
  hasFullyReviewedDirectories: boolean;
  allDirectoriesCollapsed: boolean;
}>();

defineEmits<{
  collapseReviewed: [];
  toggleAll: [];
  toggleRemaining: [];
}>();

const folderActionLabel = computed(() => props.allDirectoriesCollapsed
  ? "Expand all folders"
  : "Collapse all folders");
</script>

<template>
  <div class="review-files-toolbar" role="toolbar" aria-label="Review file display">
    <button
      class="toolbar-action"
      type="button"
      :class="{ active: remainingOnly }"
      :aria-pressed="remainingOnly"
      aria-label="Show unreviewed files only"
      title="Show unreviewed files only"
      @click="$emit('toggleRemaining')"
    ><ListFilter :size="16" aria-hidden="true" /></button>
    <button
      class="toolbar-action secondary-action"
      type="button"
      :disabled="!hasFullyReviewedDirectories"
      aria-label="Collapse fully reviewed folders"
      title="Collapse fully reviewed folders"
      @click="$emit('collapseReviewed')"
    ><FolderCheck :size="16" aria-hidden="true" /></button>
    <button
      class="toolbar-action secondary-action"
      type="button"
      :disabled="!hasDirectories"
      :aria-label="folderActionLabel"
      :title="folderActionLabel"
      @click="$emit('toggleAll')"
    >
      <ListChevronsUpDown v-if="allDirectoriesCollapsed" :size="16" aria-hidden="true" />
      <ListChevronsDownUp v-else :size="16" aria-hidden="true" />
    </button>
    <button
      class="toolbar-action more-action"
      type="button"
      popovertarget="review-files-actions-menu"
      aria-label="More review file actions"
      title="More review file actions"
    ><Ellipsis :size="16" aria-hidden="true" /></button>
    <div
      id="review-files-actions-menu"
      class="actions-menu"
      popover="auto"
      role="group"
      aria-label="More review file actions"
    >
      <button
        type="button"
        popovertarget="review-files-actions-menu"
        popovertargetaction="hide"
        :disabled="!hasFullyReviewedDirectories"
        aria-label="Collapse fully reviewed folders"
        @click="$emit('collapseReviewed')"
      ><FolderCheck :size="15" aria-hidden="true" /><span>Collapse fully reviewed folders</span></button>
      <button
        type="button"
        popovertarget="review-files-actions-menu"
        popovertargetaction="hide"
        :disabled="!hasDirectories"
        :aria-label="folderActionLabel"
        @click="$emit('toggleAll')"
      >
        <ListChevronsUpDown v-if="allDirectoriesCollapsed" :size="15" aria-hidden="true" />
        <ListChevronsDownUp v-else :size="15" aria-hidden="true" />
        <span>{{ folderActionLabel }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.review-files-toolbar { flex: none; display: flex; align-items: center; gap: 4px; }
.toolbar-action { width: 22px; height: 22px; display: grid; place-items: center; padding: 3px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--faint-foreground); cursor: pointer; }
.toolbar-action:hover:not(:disabled) { background: var(--elevated-background); color: var(--workbench-foreground); }
.toolbar-action:focus-visible, .actions-menu button:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
.toolbar-action:disabled, .actions-menu button:disabled { opacity: .35; cursor: default; }
.toolbar-action.active { background: var(--selection-background); color: var(--accent); }
.more-action { display: none; anchor-name: --review-files-actions; }
.actions-menu {
  position: fixed; position-anchor: --review-files-actions; position-area: block-end span-inline-start;
  width: max-content; min-width: 198px; margin: 4px 0 0; padding: 4px;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-sm);
  background: var(--elevated-background); color: var(--workbench-foreground);
  box-shadow: 0 6px 18px var(--workbench-shadow);
}
.actions-menu:popover-open { display: flex; flex-direction: column; gap: 1px; }
.actions-menu button { display: flex; align-items: center; gap: 8px; width: 100%; height: 26px; padding: 0 7px; border: 0; border-radius: var(--radius-sm); background: transparent; color: inherit; cursor: pointer; font: inherit; white-space: nowrap; }
.actions-menu button:hover:not(:disabled) { background: var(--hover-background); }
@container review-files (max-width: 280px) {
  .secondary-action { display: none; }
  .more-action { display: grid; }
}
</style>
