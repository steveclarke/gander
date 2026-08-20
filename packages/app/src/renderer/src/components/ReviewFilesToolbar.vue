<script setup lang="ts">
import { ListChecks, ListChevronsDownUp, ListChevronsUpDown, ListFilter } from "@lucide/vue";

defineProps<{
  remainingOnly: boolean;
  remainingCount: number;
  totalCount: number;
  hasDirectories: boolean;
}>();

defineEmits<{
  expandAll: [];
  collapseReviewed: [];
  collapseAll: [];
  toggleRemaining: [];
}>();
</script>

<template>
  <div class="review-files-toolbar" role="toolbar" aria-label="Review file display">
    <span class="remaining-count">{{ remainingCount }} of {{ totalCount }} remaining</span>
    <div class="toolbar-actions">
      <button
        type="button"
        :disabled="!hasDirectories"
        aria-label="Expand all folders"
        title="Expand all folders"
        @click="$emit('expandAll')"
      ><ListChevronsUpDown :size="14" /></button>
      <button
        type="button"
        :disabled="!hasDirectories || remainingOnly"
        aria-label="Collapse reviewed folders"
        title="Collapse reviewed folders"
        @click="$emit('collapseReviewed')"
      ><ListChecks :size="14" /></button>
      <button
        type="button"
        :disabled="!hasDirectories"
        aria-label="Collapse all folders"
        title="Collapse all folders"
        @click="$emit('collapseAll')"
      ><ListChevronsDownUp :size="14" /></button>
      <button
        type="button"
        class="filter-button"
        :class="{ active: remainingOnly }"
        :aria-pressed="remainingOnly"
        aria-label="Show remaining files only"
        title="Show remaining files only"
        @click="$emit('toggleRemaining')"
      ><ListFilter :size="14" /></button>
    </div>
  </div>
</template>

<style scoped>
.review-files-toolbar { min-height: 31px; flex: none; display: flex; align-items: center; gap: 8px; padding: 3px 7px 3px 12px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); }
.remaining-count { min-width: 0; margin-right: auto; overflow: hidden; color: var(--faint-foreground); font-size: 10px; white-space: nowrap; text-overflow: ellipsis; }
.toolbar-actions { display: flex; align-items: center; gap: 2px; }
.toolbar-actions button { width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--faint-foreground); cursor: pointer; }
.toolbar-actions button:hover:not(:disabled) { background: var(--elevated-background); color: var(--workbench-foreground); }
.toolbar-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.toolbar-actions button:disabled { opacity: .35; cursor: default; }
.toolbar-actions .filter-button.active { background: var(--selection-background); color: var(--accent); }
</style>
