<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { Note } from "@gander/shared";
import ConfirmDialog from "./ConfirmDialog.vue";
import {
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Copy,
  Trash2,
} from "@lucide/vue";

const props = defineProps<{
  note: Note;
  current: boolean;
  copied: boolean;
}>();
const emit = defineEmits<{
  navigate: [note: Note];
  copy: [note: Note];
  delete: [noteId: number];
}>();
// Deleting a note is the only thing here that cannot be taken back: its text and
// the line it was captured against go together.
const confirmingDelete = shallowRef(false);

const deleteDetail = "The note will be removed from the review. This cannot be undone.";

// A keyed note instance survives service refreshes, so a reviewer's disclosure
// choice remains stable when the Note object is replaced.
const expanded = shallowRef(props.note.state === "open");
const bodyId = computed(() => `note-body-${props.note.id}`);
const titleId = computed(() => `note-title-${props.note.id}`);
const location = computed(() => {
  if (props.note.path === null) return "This pull request";
  const name = props.note.path.split("/").pop() ?? props.note.path;
  return props.note.line === null ? name : `${name}:${props.note.line}`;
});

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : timestamp.format(date);
}
</script>

<template>
  <li
    class="note-item"
    :class="[{ current }, `state-${note.state}`]"
    :data-note-id="note.id"
    :aria-labelledby="titleId"
  >
    <div class="note-header">
      <div class="identity">
        <button
          class="location"
          data-note-location
          :disabled="note.path === null"
          :title="note.path ?? undefined"
          @click="emit('navigate', note)"
        >
          {{ location }}
        </button>
        <span class="state" :class="note.state">
          <CircleHelp v-if="note.state === 'open'" :size="12" aria-hidden="true" />
          <Check v-else-if="note.state === 'addressed'" :size="12" aria-hidden="true" />
          <CheckCheck v-else :size="12" aria-hidden="true" />
          {{ note.state }}
        </span>
      </div>
      <button
        class="disclosure"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} note ${note.id}`"
        @click="expanded = !expanded"
      >
        <span :id="titleId" class="preview">{{ note.text }}</span>
        <ChevronDown class="chevron" :class="{ expanded }" :size="15" aria-hidden="true" />
      </button>
    </div>

    <section v-show="expanded" :id="bodyId" class="note-body" data-note-body>
      <div class="note-message">
        <div class="message-heading">
          <h3>Note</h3>
          <time :datetime="note.createdAt">{{ formatTimestamp(note.createdAt) }}</time>
        </div>
        <p class="message-text">{{ note.text }}</p>
      </div>

      <section v-if="note.summary || note.commitRef" class="agent-update" aria-label="Agent update">
        <div class="message-heading">
          <h3>Agent update</h3>
          <code v-if="note.commitRef">{{ note.commitRef }}</code>
        </div>
        <p v-if="note.summary" class="message-text">{{ note.summary }}</p>
      </section>

      <div class="note-actions">
        <button
          type="button"
          :aria-label="`Copy note ${note.id}`"
          @click="emit('copy', note)"
        >
          <Copy :size="13" aria-hidden="true" />
          {{ copied ? "Copied" : "Copy note" }}
        </button>
        <button
          class="delete"
          type="button"
          :aria-label="`Delete note ${note.id}`"
          @click="confirmingDelete = true"
        >
          <Trash2 :size="13" aria-hidden="true" />
          Delete
        </button>
      </div>

      <ConfirmDialog
        :open="confirmingDelete"
        :title="`Delete this note?`"
        :detail="deleteDetail"
        confirm-label="Delete"
        @cancel="confirmingDelete = false"
        @confirm="confirmingDelete = false; emit('delete', note.id)"
      />
    </section>
  </li>
</template>

<style scoped>
.note-item {
  border-bottom: 1px solid var(--workbench-border);
  border-left: 1px solid transparent;
  min-width: 0;
}
.note-item.state-open { border-left-color: var(--accent); }
.note-item.current { background: var(--selection-background); }
.note-header { display: flex; flex-direction: column; gap: 5px; padding: 9px 10px 8px; min-width: 0; }
.identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
.location {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: none; border: none; padding: 0; color: var(--accent); font: inherit; font-size: 11.5px; cursor: pointer;
}
.location:disabled { color: var(--faint-foreground); cursor: default; }
.state {
  display: inline-flex; align-items: center; gap: 3px; flex: none;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-pill); padding: 1px 5px;
  color: var(--faint-foreground); font: 600 9px var(--mono); letter-spacing: .35px; text-transform: uppercase;
}
.state.open { color: var(--accent); }
.state.addressed { color: var(--warning); }
.state.resolved { color: var(--success); }
.disclosure {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px;
  width: 100%; min-width: 0; padding: 2px 0; border: 0; background: none; color: inherit; cursor: pointer; text-align: left;
}
.preview { min-width: 0; overflow: hidden; color: var(--workbench-foreground); font-size: 12.5px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.chevron { color: var(--faint-foreground); transition: transform 120ms ease; }
.chevron.expanded { transform: rotate(180deg); }
.note-body { padding: 1px 10px 11px; }
.note-message, .agent-update { min-width: 0; border-radius: var(--radius-md); }
.note-message { padding: 9px 10px; background: var(--input-background); border: 1px solid var(--workbench-border); }
.agent-update { margin: 8px 0 0 12px; padding: 9px 10px; border-left: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.message-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.message-heading h3 { margin: 0; color: var(--muted-foreground); font: 600 9.5px var(--mono); letter-spacing: .4px; text-transform: uppercase; }
.agent-update .message-heading h3 { color: var(--accent); }
.message-heading time { min-width: 0; color: var(--faint-foreground); font-size: 9.5px; text-align: right; }
.message-heading code { overflow: hidden; max-width: 45%; padding: 1px 5px; border-radius: var(--radius-sm); background: var(--badge-background); color: var(--muted-foreground); font: 10px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.message-text { margin: 4px 0 0; min-width: 0; color: var(--workbench-foreground); font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.note-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.note-actions button { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 2px 0; background: none; color: var(--muted-foreground); font: inherit; font-size: 10.5px; cursor: pointer; }
.note-actions .delete { margin-left: auto; color: var(--faint-foreground); }
.note-actions .delete:hover { color: var(--danger); }
.location:focus-visible, .disclosure:focus-visible, .note-actions button:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
</style>
