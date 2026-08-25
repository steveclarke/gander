<script setup lang="ts">
import { FileDiff, Files, GitPullRequest, Settings } from "@lucide/vue";
import { computed, shallowRef, type Component } from "vue";
import {
  reorderActivity,
  useActivityOrder,
  type ActivityMode,
  type DropEdge,
} from "../composables/use-activity-order.js";

defineProps<{ active: "explorer" | "changes" | "pulls" | "settings"; hasTarget: boolean }>();
const emit = defineEmits<{ select: [value: "explorer" | "changes" | "pulls" | "settings"] }>();
const actionById: Record<ActivityMode, { id: ActivityMode; label: string; icon: Component }> = {
  pulls: { id: "pulls", label: "Pull Requests", icon: GitPullRequest },
  explorer: { id: "explorer", label: "Explorer", icon: Files },
  changes: { id: "changes", label: "Current Diff", icon: FileDiff },
};

const { order, setOrder, move } = useActivityOrder();
const actions = computed(() => order.value.map((id) => actionById[id]));
const dragged = shallowRef<ActivityMode | null>(null);
const dropTarget = shallowRef<{ id: ActivityMode; edge: DropEdge } | null>(null);

function onDragStart(event: DragEvent, id: ActivityMode): void {
  dragged.value = id;
  event.dataTransfer?.setData("text/plain", id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragOver(event: DragEvent, id: ActivityMode): void {
  if (dragged.value === null || dragged.value === id) {
    dropTarget.value = null;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget.value = {
    id,
    edge: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
  };
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  if (dragged.value && dropTarget.value) {
    setOrder(reorderActivity(order.value, dragged.value, dropTarget.value.id, dropTarget.value.edge));
  }
  clearDrag();
}

function clearDrag(): void {
  dragged.value = null;
  dropTarget.value = null;
}

function onKeydown(event: KeyboardEvent, id: ActivityMode): void {
  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  event.preventDefault();
  event.stopPropagation();
  move(id, event.key === "ArrowUp" ? -1 : 1);
}
</script>

<template>
  <nav class="rail" aria-label="Workspace views" aria-describedby="activity-order-help">
    <span id="activity-order-help" class="sr-only">Drag workspace views to reorder them. With a view focused, press Alt and the up or down arrow key to move it.</span>
    <button
      v-for="action in actions"
      :key="action.id"
      class="rail-action"
      :class="{
        active: active === action.id,
        dragging: dragged === action.id,
        'drop-before': dropTarget?.id === action.id && dropTarget.edge === 'before',
        'drop-after': dropTarget?.id === action.id && dropTarget.edge === 'after',
      }"
      :disabled="!hasTarget"
      :aria-label="action.label"
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      :title="action.label"
      draggable="true"
      @click="emit('select', action.id)"
      @dragstart="onDragStart($event, action.id)"
      @dragover="onDragOver($event, action.id)"
      @drop="onDrop"
      @dragend="clearDrag"
      @keydown="onKeydown($event, action.id)"
    >
      <component :is="action.icon" :size="22" />
    </button>
    <span class="spacer" />
    <button class="rail-action settings-action" :class="{ active: active === 'settings' }" aria-label="Editor settings" title="Editor settings" @click="emit('select', 'settings')"><Settings :size="21" /></button>
  </nav>
</template>

<style scoped>
.rail { width: 48px; flex: none; display: flex; flex-direction: column; align-items: stretch; background: var(--panel-background); border-right: 1px solid var(--workbench-border); }
.rail-action { position: relative; height: 48px; display: grid; place-items: center; border: 0; background: none; color: var(--faint-foreground); cursor: grab; user-select: none; }
.rail-action:hover:not(:disabled) { color: var(--workbench-foreground); background: var(--hover-background); }
.rail-action.active { color: var(--workbench-foreground); }
.rail-action.active::before { content: ""; position: absolute; inset-block: 8px; inset-inline-start: 0; width: 2px; background: var(--accent); }
.rail-action.dragging { opacity: .4; cursor: grabbing; }
.rail-action.drop-before::after, .rail-action.drop-after::after { content: ""; position: absolute; inset-inline: 7px; height: 2px; background: var(--accent); pointer-events: none; }
.rail-action.drop-before::after { inset-block-start: -1px; }
.rail-action.drop-after::after { inset-block-end: -1px; }
.rail-action:disabled { opacity: .55; cursor: default; }
.rail-action:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.settings-action { cursor: pointer; }
.spacer { flex: 1; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
