<script setup lang="ts">
import type { LocalWorktree } from "@gander/shared";
import { GitBranch, LockKeyhole } from "lucide-vue-next";

defineProps<{ worktrees: LocalWorktree[]; selectedPath: string | null }>();
const emit = defineEmits<{ select: [path: string] }>();

function name(worktree: LocalWorktree): string {
  return worktree.branch ?? `Detached at ${worktree.headSha.slice(0, 8)}`;
}

function folder(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
</script>

<template>
  <div class="worktree-list" role="listbox" aria-label="Local worktrees">
    <button
      v-for="worktree in worktrees"
      :key="worktree.path"
      type="button"
      class="sw-item local-worktree"
      role="option"
      :aria-selected="worktree.path === selectedPath"
      @click="emit('select', worktree.path)"
    >
      <GitBranch :size="14" aria-hidden="true" />
      <span class="identity">
        <span class="branch">{{ name(worktree) }}</span>
        <span class="folder">{{ folder(worktree.path) }}</span>
      </span>
      <LockKeyhole v-if="worktree.locked" :size="12" aria-label="Locked worktree" />
    </button>
  </div>
</template>

<style scoped>
.sw-item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px 14px; color: var(--workbench-foreground); text-align: left; background: transparent; border: 0; font: inherit; cursor: pointer; }
.sw-item:hover { background: var(--selection-background); }
.sw-item[aria-selected="true"] { background: var(--selection-background); }
.sw-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.sw-item > svg { flex: none; color: var(--muted-foreground); }
.identity { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.branch, .folder { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.branch { font-size: 12px; }
.folder { color: var(--faint-foreground); font: 10.5px var(--mono); }
</style>
