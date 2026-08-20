<script setup lang="ts">
import { ListChevronsDownUp, ListFilter } from "@lucide/vue";

defineProps<{
  remainingOnly: boolean;
  hasDirectories: boolean;
}>();

defineEmits<{
  collapseAll: [];
  toggleRemaining: [];
}>();
</script>

<template>
  <div class="review-files-toolbar" role="toolbar" aria-label="Review file display">
    <div class="toolbar-actions">
      <button
        type="button"
        class="filter-button"
        :class="{ active: remainingOnly }"
        :aria-pressed="remainingOnly"
        aria-label="Show remaining files only"
        title="Show remaining files only"
        @click="$emit('toggleRemaining')"
      ><ListFilter :size="14" /><span>Remaining</span></button>
      <button
        type="button"
        class="collapse-button"
        :disabled="!hasDirectories"
        aria-label="Collapse all folders"
        title="Collapse all folders"
        @click="$emit('collapseAll')"
      ><ListChevronsDownUp :size="14" /></button>
    </div>
  </div>
</template>

<style scoped>
.review-files-toolbar { min-height: 31px; flex: none; display: flex; align-items: center; padding: 3px 7px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); }
.toolbar-actions { width: 100%; display: flex; align-items: center; gap: 2px; }
.toolbar-actions button { min-width: 0; height: 24px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 4px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--faint-foreground); font: inherit; font-size: 10px; cursor: pointer; }
.toolbar-actions button svg { flex: none; }
.toolbar-actions .filter-button { flex: 1; }
.toolbar-actions .collapse-button { width: 24px; flex: none; padding: 0; }
.toolbar-actions button:hover:not(:disabled) { background: var(--elevated-background); color: var(--workbench-foreground); }
.toolbar-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.toolbar-actions button:disabled { opacity: .35; cursor: default; }
.toolbar-actions .filter-button.active { background: var(--selection-background); color: var(--workbench-foreground); }
</style>
