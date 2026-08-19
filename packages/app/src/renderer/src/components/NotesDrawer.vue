<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { Note } from "@gander/shared";
import { Copy, MessageSquare, PanelBottom, PanelRight, Plus, X } from "@lucide/vue";
import type { Store } from "../store.js";
import { revealLine } from "../selection.js";
import NoteItem from "./NoteItem.vue";

const props = defineProps<{ store: Store; dock: "right" | "bottom" }>();
const emit = defineEmits<{ close: []; dock: ["right" | "bottom"]; addNote: [] }>();

const notes = computed(() => props.store.view?.notes ?? []);
const copiedNoteId = shallowRef<number | null>(null);
const copiedAll = shallowRef(false);

function goTo(q: { path: string | null; line: number | null }): void {
  if (q.path === null) return;
  props.store.select(q.path);
  if (q.line !== null) revealLine(q.line);
}

function noteMarkdown(note: Note): string {
  const location = note.path === null
    ? "Pull request"
    : `${note.path}${note.line === null ? "" : `:${note.line}`}`;
  const parts = [
    `### ${location} — ${note.state}`,
    "",
    `Reviewer: ${note.text}`,
  ];
  if (note.summary || note.commitRef) {
    const commit = note.commitRef ? ` (${note.commitRef})` : "";
    parts.push("", `Agent update${commit}: ${note.summary ?? "Addressed"}`);
  }
  return parts.join("\n");
}

async function copyText(text: string, noteId: number | null): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
    await navigator.clipboard.writeText(text);
    copiedNoteId.value = noteId;
    copiedAll.value = noteId === null;
  } catch (error) {
    props.store.error = (error as Error).message;
  }
}

async function copyNote(note: Note): Promise<void> {
  await copyText(noteMarkdown(note), note.id);
}

async function copyAll(): Promise<void> {
  await copyText(notes.value.map(noteMarkdown).join("\n\n"), null);
}
</script>

<template>
  <aside class="drawer" aria-label="Notes">
    <header>
      <MessageSquare :size="15" />
      <h2 class="title">Notes</h2>
      <span class="count">{{ notes.length }}</span>
      <button
        v-if="notes.length > 0"
        class="copy-all"
        aria-label="Copy all notes"
        title="Copy all notes"
        @click="copyAll"
      >
        <Copy :size="13" aria-hidden="true" />
        <span>{{ copiedAll ? "Copied" : "Copy all" }}</span>
      </button>
      <button
        class="add"
        aria-label="Add note (N)"
        title="Add note (N)"
        @click="emit('addNote')"
      >
        <Plus :size="14" aria-hidden="true" />
        <span>Add</span>
      </button>
      <button
        class="close dockbtn"
        :aria-label="dock === 'right' ? 'Dock notes below the diff' : 'Dock notes beside the diff'"
        :title="dock === 'right' ? 'Dock below the diff' : 'Dock beside the diff'"
        @click="$emit('dock', dock === 'right' ? 'bottom' : 'right')"
      >
        <component :is="dock === 'right' ? PanelBottom : PanelRight" :size="15" />
      </button>
      <button class="close" aria-label="Close notes" title="Close notes" @click="$emit('close')">
        <X :size="15" />
      </button>
    </header>

    <div v-if="notes.length === 0" class="empty">
      <p>Capture a note about the selected file or line.</p>
      <button type="button" @click="emit('addNote')">
        <Plus :size="14" aria-hidden="true" />
        Add note <kbd>N</kbd>
      </button>
    </div>

    <ul v-else aria-label="Review notes">
      <NoteItem
        v-for="note in notes"
        :key="note.id"
        :note="note"
        :current="note.path === store.selectedPath"
        :copied="copiedNoteId === note.id"
        @navigate="goTo"
        @copy="copyNote"
        @delete="store.deleteNote"
      />
    </ul>
  </aside>
</template>

<style scoped>
.drawer { container: notes / inline-size; display: flex; flex-direction: column; background: var(--panel-background); border-left: 1px solid var(--workbench-border); overflow: hidden auto; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--workbench-border); color: var(--muted-foreground); flex: none; }
.title { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
.count { font: 11px var(--mono); background: var(--badge-background); border-radius: var(--radius-pill); padding: 1px 7px; }
.add, .copy-all {
  display: flex; align-items: center; gap: 4px;
  background: none; border: 1px solid var(--workbench-border); border-radius: var(--radius-md);
  color: var(--workbench-foreground); padding: 3px 7px; font: inherit; font-size: 11px; cursor: pointer;
}
.copy-all { margin-left: auto; }
.add:first-of-type { margin-left: auto; }
.add:hover, .copy-all:hover { border-color: var(--accent); color: var(--accent); }
.dockbtn { margin-left: 0; }
.dockbtn + .close { margin-left: 0; }
.close { margin-left: auto; background: none; border: none; color: var(--faint-foreground); cursor: pointer; display: flex; }
.close:hover { color: var(--workbench-foreground); }

.empty { color: var(--faint-foreground); font-size: 12px; padding: 16px 12px; line-height: 1.6; }
.empty p { margin-bottom: 10px; }
.empty button {
  display: flex; align-items: center; gap: 6px;
  background: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius-md);
  color: var(--accent-foreground); padding: 5px 9px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.empty button kbd { color: var(--workbench-foreground); }
.add:focus-visible, .copy-all:focus-visible, .empty button:focus-visible, .close:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
kbd { font: 11px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-sm); padding: 1px 5px; }

ul { list-style: none; margin: 0; padding: 0; }
@container notes (max-width: 330px) {
  .copy-all span, .add span { display: none; }
}
</style>
