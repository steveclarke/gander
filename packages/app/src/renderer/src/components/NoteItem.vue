<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef } from "vue";
import type { Note, NoteState } from "@gander/shared";
import { basename } from "../paths.js";
import ConfirmDialog from "./ConfirmDialog.vue";
import {
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Copy,
  Pencil,
  Trash2,
} from "@lucide/vue";

const props = defineProps<{
  note: Note;
  current: boolean;
  copied: boolean;
  updateNote: (id: number, input: { text?: string; state?: NoteState }) => Promise<void>;
}>();
const emit = defineEmits<{
  navigate: [note: Note];
  copy: [note: Note];
  delete: [noteId: number];
}>();
// Deleting a note is the only thing here that cannot be taken back: its text and
// the line it was captured against go together.
const confirmingDelete = shallowRef(false);
const editing = shallowRef(false);
const draftText = shallowRef(props.note.text);
const savingEdit = shallowRef(false);
const changingStatus = shallowRef(false);
const editInput = useTemplateRef<HTMLTextAreaElement>("editInput");

const deleteDetail = "The note will be removed from the review. This cannot be undone.";

// A keyed note instance survives service refreshes, so a reviewer's disclosure
// choice remains stable when the Note object is replaced.
const expanded = shallowRef(props.note.state === "open");
const bodyId = computed(() => `note-body-${props.note.id}`);
const titleId = computed(() => `note-title-${props.note.id}`);
const location = computed(() => {
  if (props.note.path === null) return "This pull request";
  const name = basename(props.note.path);
  return props.note.line === null ? name : `${name}:${props.note.line}`;
});

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : timestamp.format(date);
}

async function startEditing(): Promise<void> {
  draftText.value = props.note.text;
  editing.value = true;
  await nextTick();
  editInput.value?.focus();
}

function cancelEditing(): void {
  draftText.value = props.note.text;
  editing.value = false;
}

async function saveEdit(): Promise<void> {
  const text = draftText.value.trim();
  if (text === "" || text === props.note.text) {
    if (text !== "") cancelEditing();
    return;
  }
  savingEdit.value = true;
  try {
    await props.updateNote(props.note.id, { text });
    await nextTick();
    if (props.note.text === text) editing.value = false;
  } finally {
    savingEdit.value = false;
  }
}

async function changeStatus(event: Event): Promise<void> {
  const select = event.currentTarget as HTMLSelectElement;
  changingStatus.value = true;
  try {
    await props.updateNote(props.note.id, { state: select.value as NoteState });
    await nextTick();
    // The store owns the saved value. This also restores the control after a failed write.
    select.value = props.note.state;
  } finally {
    changingStatus.value = false;
  }
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
        <label class="state" :class="note.state">
          <CircleHelp v-if="note.state === 'open'" :size="12" aria-hidden="true" />
          <Check v-else-if="note.state === 'addressed'" :size="12" aria-hidden="true" />
          <CheckCheck v-else :size="12" aria-hidden="true" />
          <span class="status-label">Status</span>
          <select :value="note.state" :aria-label="`Status for note ${note.id}`" :disabled="changingStatus" @change="changeStatus">
            <option value="open">Open</option>
            <option value="addressed">Addressed</option>
            <option value="resolved">Resolved</option>
          </select>
          <ChevronDown class="status-chevron" :size="10" aria-hidden="true" />
        </label>
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
        <form v-if="editing" class="edit-form" @submit.prevent="saveEdit" @keydown.esc.prevent="cancelEditing">
          <textarea ref="editInput" v-model="draftText" :aria-label="`Edit note ${note.id}`" :disabled="savingEdit" rows="4" />
          <div class="edit-actions">
            <button type="button" :disabled="savingEdit" @click="cancelEditing">Cancel</button>
            <button class="save" type="submit" :disabled="savingEdit || draftText.trim() === ''">{{ savingEdit ? "Saving…" : "Save" }}</button>
          </div>
        </form>
        <p v-else class="message-text">{{ note.text }}</p>
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
          v-if="!editing"
          type="button"
          :aria-label="`Edit note ${note.id}`"
          @click="startEditing"
        >
          <Pencil :size="13" aria-hidden="true" />
          Edit
        </button>
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
  min-height: 22px; border: 1px solid var(--workbench-border); border-radius: var(--radius-pill); padding: 0 7px;
  color: var(--faint-foreground); font-size: 11px; font-weight: 600;
}
.status-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.state select {
  appearance: none; border: 0; outline: 0; padding: 0; background: transparent; color: inherit;
  font: inherit; letter-spacing: normal; text-transform: none; cursor: pointer;
}
.state select:disabled { cursor: wait; opacity: .65; }
.status-chevron { margin-left: -2px; pointer-events: none; }
.state:focus-within { outline: 1px solid var(--accent); outline-offset: 1px; }
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
.edit-form { margin-top: 6px; }
.edit-form textarea {
  box-sizing: border-box; width: 100%; resize: vertical; border: 1px solid var(--accent); border-radius: var(--radius-sm);
  padding: 7px 8px; background: var(--panel-background); color: var(--workbench-foreground); font: inherit; font-size: 12.5px; line-height: 1.45;
}
.edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.edit-actions button { border: 1px solid var(--workbench-border); border-radius: var(--radius-sm); padding: 3px 9px; background: var(--input-background); color: var(--workbench-foreground); font: inherit; font-size: 11px; cursor: pointer; }
.edit-actions .save { border-color: var(--accent); background: var(--accent); color: var(--accent-foreground); }
.edit-actions .save:disabled { opacity: .5; cursor: default; }
.edit-form textarea:disabled, .edit-actions button:disabled { cursor: wait; }
.note-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.note-actions button { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 2px 0; background: none; color: var(--muted-foreground); font: inherit; font-size: 10.5px; cursor: pointer; }
.note-actions .delete { margin-left: auto; color: var(--faint-foreground); }
.note-actions .delete:hover { color: var(--danger); }
.location:focus-visible, .disclosure:focus-visible, .edit-form textarea:focus-visible, .edit-actions button:focus-visible, .note-actions button:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
</style>
