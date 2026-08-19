<script setup lang="ts">
import { GitBranch, GitPullRequest, X } from "lucide-vue-next";
import { nextTick } from "vue";
import type { WorkspaceTab } from "../store.js";

defineProps<{ tabs: WorkspaceTab[]; activeKey: string | null; integratedTitleBar: boolean }>();
const emit = defineEmits<{ activate: [key: string]; close: [key: string] }>();

function onTabKey(event: KeyboardEvent, key: string): void {
  const tabs = event.currentTarget instanceof HTMLElement
    ? [...event.currentTarget.closest("[role='tablist']")?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []]
    : [];
  const index = tabs.findIndex((tab) => tab.dataset.key === key);
  if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0
    : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const target = tabs[next];
  if (!target) return;
  emit("activate", target.dataset.key ?? "");
  void nextTick(() => target.focus());
}
</script>

<template>
  <div class="tabbar" :class="{ draggable: integratedTitleBar }" role="tablist" aria-label="Open workspaces">
    <div class="traffic-space" v-if="integratedTitleBar" aria-hidden="true" />
    <div
      v-for="(tab, index) in tabs"
      :key="tab.key"
      class="context-tab"
      :class="{ active: tab.key === activeKey }"
    >
      <button class="tab-target" role="tab" :data-key="tab.key" :tabindex="tab.key === activeKey || (activeKey === null && index === 0) ? 0 : -1" :aria-selected="tab.key === activeKey" @click="emit('activate', tab.key)" @keydown="onTabKey($event, tab.key)">
        <GitBranch v-if="tab.type === 'local'" :size="14" />
        <GitPullRequest v-else :size="14" />
        <span class="repo">{{ tab.repoId.split('/').at(-1) }}</span>
        <span class="separator">/</span>
        <span class="label">{{ tab.label }}</span>
      </button>
      <button
        class="close"
        :aria-label="`Close ${tab.label}`"
        @click="emit('close', tab.key)"
      ><X :size="13" /></button>
    </div>
    <div class="drag-fill" />
  </div>
</template>

<style scoped>
.tabbar { height: 38px; display: flex; align-items: stretch; background: var(--panel-background); border-bottom: 1px solid var(--workbench-border); overflow-x: auto; scrollbar-width: none; }
.tabbar.draggable, .drag-fill { -webkit-app-region: drag; }
.traffic-space { width: 78px; flex: none; }
.context-tab { -webkit-app-region: no-drag; min-width: 145px; max-width: 260px; display: flex; align-items: center; border-right: 1px solid var(--workbench-border); background: var(--input-background); color: var(--muted-foreground); }
.context-tab.active { background: var(--workbench-background); color: var(--workbench-foreground); box-shadow: inset 0 2px 0 var(--accent); }
.tab-target { min-width: 0; flex: 1; align-self: stretch; display: flex; align-items: center; gap: 6px; padding: 0 4px 0 12px; border: 0; background: none; color: inherit; cursor: pointer; font: inherit; }
.tab-target:focus-visible, .close:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.repo { font-weight: 650; }
.separator { color: var(--faint-foreground); }
.label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.close { margin: 0 6px 0 auto; width: 22px; height: 22px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 5px; background: none; color: inherit; cursor: pointer; opacity: .55; }
.close:hover { background: var(--hover-background); opacity: 1; }
.drag-fill { min-width: 40px; flex: 1; }
</style>
