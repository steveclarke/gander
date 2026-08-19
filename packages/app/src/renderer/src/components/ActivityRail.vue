<script setup lang="ts">
import { FileDiff, Files, GitPullRequest, Settings } from "lucide-vue-next";

defineProps<{ active: "explorer" | "changes" | "pulls" | "settings"; hasTarget: boolean }>();
const emit = defineEmits<{ select: [value: "explorer" | "changes" | "pulls" | "settings"] }>();
const actions = [
  { id: "explorer" as const, label: "Explorer", icon: Files },
  { id: "changes" as const, label: "Current Diff", icon: FileDiff },
  { id: "pulls" as const, label: "Pull Requests", icon: GitPullRequest },
];
</script>

<template>
  <nav class="rail" aria-label="Workspace views">
    <button v-for="action in actions" :key="action.id" :class="{ active: active === action.id }" :disabled="!hasTarget" :aria-label="action.label" :title="action.label" @click="emit('select', action.id)">
      <component :is="action.icon" :size="22" />
    </button>
    <span class="spacer" />
    <button :class="{ active: active === 'settings' }" aria-label="Editor settings" title="Editor settings" @click="emit('select', 'settings')"><Settings :size="21" /></button>
  </nav>
</template>

<style scoped>
.rail { width: 48px; flex: none; display: flex; flex-direction: column; align-items: stretch; background: var(--panel-background); border-right: 1px solid var(--workbench-border); }
button { position: relative; height: 48px; display: grid; place-items: center; border: 0; background: none; color: var(--faint-foreground); cursor: pointer; }
button:hover:not(:disabled) { color: var(--workbench-foreground); background: var(--hover-background); }
button.active { color: var(--workbench-foreground); }
button.active::before { content: ""; position: absolute; inset-block: 8px; inset-inline-start: 0; width: 2px; background: var(--accent); }
button:disabled { opacity: .28; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.spacer { flex: 1; }
</style>
