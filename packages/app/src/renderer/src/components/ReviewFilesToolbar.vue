<script setup lang="ts">
import { computed } from "vue";
import { FolderCheck, ListChevronsDownUp, ListChevronsUpDown, ListFilter } from "@lucide/vue";

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
      type="button"
      :class="{ active: remainingOnly }"
      :aria-pressed="remainingOnly"
      aria-label="Show unreviewed files only"
      title="Show unreviewed files only"
      @click="$emit('toggleRemaining')"
    ><ListFilter :size="16" /></button>
    <button
      type="button"
      :disabled="!hasFullyReviewedDirectories"
      aria-label="Collapse fully reviewed folders"
      title="Collapse fully reviewed folders"
      @click="$emit('collapseReviewed')"
    ><FolderCheck :size="16" /></button>
    <button
      type="button"
      :disabled="!hasDirectories"
      :aria-label="folderActionLabel"
      :title="folderActionLabel"
      @click="$emit('toggleAll')"
    >
      <ListChevronsUpDown v-if="allDirectoriesCollapsed" :size="16" />
      <ListChevronsDownUp v-else :size="16" />
    </button>
  </div>
</template>

<style scoped>
.review-files-toolbar { flex: none; display: flex; align-items: center; gap: 4px; }
.review-files-toolbar button { width: 22px; height: 22px; display: grid; place-items: center; padding: 3px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--faint-foreground); cursor: pointer; }
.review-files-toolbar button:hover:not(:disabled) { background: var(--elevated-background); color: var(--workbench-foreground); }
.review-files-toolbar button:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
.review-files-toolbar button:disabled { opacity: .35; cursor: default; }
.review-files-toolbar button.active { background: var(--selection-background); color: var(--accent); }
</style>
