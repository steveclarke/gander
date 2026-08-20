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
    <button
      type="button"
      :class="{ active: remainingOnly }"
      :aria-pressed="remainingOnly"
      aria-label="Show remaining files only"
      title="Show remaining files only"
      @click="$emit('toggleRemaining')"
    ><ListFilter :size="16" /></button>
    <button
      type="button"
      :disabled="!hasDirectories"
      aria-label="Collapse all folders"
      title="Collapse all folders"
      @click="$emit('collapseAll')"
    ><ListChevronsDownUp :size="16" /></button>
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
