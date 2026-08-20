<script setup lang="ts">
import { computed } from "vue";
import type { NoteState } from "@gander/shared";
import { ChevronDown, Copy, ListFilter, Plus } from "@lucide/vue";

export type NoteStatusFilter = "all" | NoteState;

const props = defineProps<{
  counts: Record<NoteStatusFilter, number>;
  copiedAll: boolean;
}>();
const filter = defineModel<NoteStatusFilter>({ required: true });
defineEmits<{ addNote: []; copyAll: [] }>();

const options = computed<{ value: NoteStatusFilter; label: string }[]>(() => [
  { value: "all", label: `All statuses (${props.counts.all})` },
  { value: "open", label: `Open (${props.counts.open})` },
  { value: "in_progress", label: `In progress (${props.counts.in_progress})` },
  { value: "addressed", label: `Addressed (${props.counts.addressed})` },
  { value: "resolved", label: `Resolved (${props.counts.resolved})` },
]);
</script>

<template>
  <div class="notes-toolbar" role="toolbar" aria-label="Note display and actions">
    <label class="status-filter">
      <ListFilter :size="14" aria-hidden="true" />
      <select v-model="filter" aria-label="Filter notes by status" :disabled="counts.all === 0">
        <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <ChevronDown class="filter-chevron" :size="13" aria-hidden="true" />
    </label>

    <div class="toolbar-actions">
      <button
        v-if="counts.all > 0"
        type="button"
        aria-label="Copy all notes"
        title="Copy all notes"
        @click="$emit('copyAll')"
      >
        <Copy :size="13" aria-hidden="true" />
        <span>{{ copiedAll ? "Copied" : "Copy all" }}</span>
      </button>
      <button
        type="button"
        aria-label="Add note (N)"
        title="Add note (N)"
        @click="$emit('addNote')"
      >
        <Plus :size="14" aria-hidden="true" />
        <span>Add</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.notes-toolbar {
  flex: none; display: flex; align-items: center; gap: 8px;
  min-height: 36px; padding: 5px 8px;
  border-bottom: 1px solid var(--workbench-border);
  background: var(--input-background);
}
.status-filter {
  position: relative; flex: 0 1 154px; min-width: 112px; height: 26px;
  display: flex; align-items: center; color: var(--faint-foreground);
}
.status-filter > svg:first-child { position: absolute; left: 7px; pointer-events: none; }
.status-filter select {
  width: 100%; height: 100%; min-width: 0; appearance: none;
  padding: 0 25px 0 27px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md);
  background: var(--panel-background); color: var(--workbench-foreground);
  font: inherit; font-size: 11px; cursor: pointer;
}
.status-filter:hover select:not(:disabled) { border-color: var(--muted-foreground); }
.status-filter:focus-within { color: var(--accent); }
.status-filter select:focus-visible,
.toolbar-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.status-filter select:disabled { opacity: .5; cursor: default; }
.filter-chevron { position: absolute; right: 7px; pointer-events: none; }
.toolbar-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.toolbar-actions button {
  height: 26px; display: flex; align-items: center; gap: 4px;
  padding: 0 7px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md);
  background: var(--panel-background); color: var(--workbench-foreground);
  font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer;
}
.toolbar-actions button:hover { border-color: var(--accent); color: var(--accent); }

@container notes (max-width: 330px) {
  .toolbar-actions button { width: 26px; justify-content: center; padding: 0; }
  .toolbar-actions span { display: none; }
}
</style>
