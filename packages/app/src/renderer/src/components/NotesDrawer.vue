<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { Note, NoteState } from "@gander/shared";
import { MessageSquare, PanelBottom, PanelRight, Plus, X } from "@lucide/vue";
import type { Store } from "../store.js";
import { revealLine } from "../selection.js";
import NoteItem from "./NoteItem.vue";
import NotesToolbar, { type NoteStatusFilter } from "./NotesToolbar.vue";

const props = defineProps<{ store: Store; dock: "right" | "bottom" }>();
const emit = defineEmits<{ close: []; dock: ["right" | "bottom"]; addNote: [] }>();

const notes = computed(() => props.store.view?.notes ?? []);
const statusFilter = shallowRef<NoteStatusFilter>("all");
const statusCounts = computed<Record<NoteStatusFilter, number>>(() => ({
  all: notes.value.length,
  open: countNotes("open"),
  in_progress: countNotes("in_progress"),
  addressed: countNotes("addressed"),
  resolved: countNotes("resolved"),
}));
const visibleNotes = computed(() => statusFilter.value === "all"
  ? notes.value
  : notes.value.filter((note) => note.state === statusFilter.value));
const noteGroups = computed(() => [
  { key: "open", label: "Open", notes: visibleNotes.value.filter((note) => note.state === "open") },
  { key: "in-progress", label: "In progress", notes: visibleNotes.value.filter((note) => note.state === "in_progress" && note.inProgressNote === null) },
  { key: "waiting", label: "Waiting on you", notes: visibleNotes.value.filter((note) => note.state === "in_progress" && note.inProgressNote !== null) },
  { key: "addressed", label: "Addressed", notes: visibleNotes.value.filter((note) => note.state === "addressed") },
  { key: "resolved", label: "Resolved", notes: visibleNotes.value.filter((note) => note.state === "resolved") },
].filter((group) => group.notes.length > 0));
type NoteRow =
  | { key: string; kind: "heading"; label: string; count: number }
  | { key: string; kind: "note"; note: Note };
const noteRows = computed<NoteRow[]>(() => noteGroups.value.flatMap((group) => [
  { key: `heading-${group.key}`, kind: "heading" as const, label: group.label, count: group.notes.length },
  ...group.notes.map((note) => ({ key: `note-${note.id}`, kind: "note" as const, note })),
]));
const copiedNoteId = shallowRef<number | null>(null);
const copiedAll = shallowRef(false);

function countNotes(state: NoteState): number {
  return notes.value.filter((note) => note.state === state).length;
}

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
    `### Note ${note.number} — ${location} — ${note.state}`,
    "",
    `Reviewer: ${note.text}`,
  ];
  if (note.summary || note.commitRef) {
    const commit = note.commitRef ? ` (${note.commitRef})` : "";
    parts.push("", `Agent update${commit}: ${note.summary ?? "Addressed"}`);
  }
  if (note.state === "in_progress" && note.inProgressNote) parts.push("", `Waiting on reviewer: ${note.inProgressNote}`);
  if (note.sourceContext) {
    const { startLine, lines } = note.sourceContext;
    const source = lines
      .map((line, index) => `${startLine + index}: ${line}`)
      .join("\n");
    parts.push("", "```", source, "```");
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

    <NotesToolbar
      v-model="statusFilter"
      :counts="statusCounts"
      :copied-all="copiedAll"
      @copy-all="copyAll"
      @add-note="emit('addNote')"
    />

    <div v-if="notes.length === 0" class="empty">
      <p>Capture a note about the selected file or line.</p>
      <button type="button" @click="emit('addNote')">
        <Plus :size="14" aria-hidden="true" />
        Add note <kbd>N</kbd>
      </button>
    </div>

    <div v-else-if="visibleNotes.length === 0" class="empty filtered-empty">
      <p>No notes have this status.</p>
      <button type="button" @click="statusFilter = 'all'">Show all notes</button>
    </div>

    <ul v-else aria-label="Review notes">
      <template v-for="row in noteRows" :key="row.key">
        <li v-if="row.kind === 'heading'" class="group-heading" role="presentation">{{ row.label }} <span>{{ row.count }}</span></li>
        <NoteItem
          v-else
          :note="row.note"
          :current="row.note.path === store.selectedPath"
          :copied="copiedNoteId === row.note.id"
          :update-note="store.updateNote"
          @navigate="goTo"
          @copy="copyNote"
          @delete="store.deleteNote"
        />
      </template>
    </ul>
  </aside>
</template>

<style scoped>
.drawer { container: notes / inline-size; display: flex; flex-direction: column; background: var(--panel-background); border-left: 1px solid var(--workbench-border); overflow: hidden auto; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--workbench-border); color: var(--muted-foreground); flex: none; }
.title { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
.count { font: 11px var(--mono); background: var(--badge-background); border-radius: var(--radius-pill); padding: 1px 7px; }
.dockbtn { margin-left: auto; }
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
.empty button:focus-visible, .close:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
kbd { font: 11px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-sm); padding: 1px 5px; }

ul { list-style: none; margin: 0; padding: 0; }
.group-heading {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px; border-bottom: 1px solid var(--workbench-border);
  background: var(--input-background); color: var(--muted-foreground);
  font: 600 9.5px var(--mono); letter-spacing: .4px; text-transform: uppercase;
}
.group-heading span { color: var(--faint-foreground); }
</style>
