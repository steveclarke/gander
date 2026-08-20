<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";

/**
 * The strip above the work surface naming what is open: the repository, then the branch or
 * the pull request, then whatever the reviewer can do to it. Refreshing and a count are on
 * every surface, so they are props rather than slots — the surface only supplies its own
 * actions.
 */
defineProps<{
  title: string;
  refreshLabel: string;
  busy: boolean;
  progress: string;
  /** The end-to-end suite waits on `local-progress` to know the local view has arrived. */
  progressClass?: string;
}>();
defineEmits<{ refresh: [] }>();
</script>

<template>
  <div class="context-toolbar">
    <div class="context-title">
      <strong>{{ title }}</strong>
      <span><slot name="subtitle" /></span>
    </div>
    <slot />
    <button :disabled="busy" :aria-label="refreshLabel" :title="refreshLabel" @click="$emit('refresh')">
      <RefreshCw :size="15" :class="{ spin: busy }" />
    </button>
    <span class="progress" :class="progressClass">{{ progress }}</span>
  </div>
</template>

<style scoped>
.context-toolbar { height: 35px; flex: none; display: flex; align-items: center; gap: 6px; padding-inline: 12px 7px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); }
.context-title { min-width: 0; display: flex; align-items: baseline; gap: 7px; margin-right: auto; }
.context-title strong { font-size: 12px; }
.context-title span { min-width: 0; display: flex; align-items: center; gap: 5px; color: var(--muted-foreground); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.context-toolbar button, .context-toolbar :slotted(button) { min-height: 26px; display: flex; align-items: center; gap: 5px; padding: 3px 8px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--elevated-background); color: var(--muted-foreground); font: inherit; cursor: pointer; }
.context-toolbar button:hover, .context-toolbar :slotted(button:hover) { color: var(--workbench-foreground); border-color: var(--faint-foreground); }
.context-toolbar button:focus-visible, .context-toolbar :slotted(button:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
.context-toolbar button:disabled, .context-toolbar :slotted(button:disabled) { opacity: .55; cursor: default; }
.progress { padding-inline: 4px; color: var(--faint-foreground); font-size: 11px; white-space: nowrap; }
</style>
