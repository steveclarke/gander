<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from "vue";
import type { Store } from "../store.js";
import type { NoteTarget } from "../selection.js";

const props = defineProps<{ store: Store; target: NoteTarget | null }>();
const emit = defineEmits<{ close: [] }>();

const text = shallowRef("");
const saving = shallowRef(false);
const canSave = computed(() => text.value.trim().length > 0 && !saving.value);
const box = useTemplateRef<HTMLTextAreaElement>("box");

watch(() => props.target, async (target) => {
  if (target === null) return;
  text.value = "";
  await nextTick();
  box.value?.focus();
});

async function submit(): Promise<void> {
  if (!canSave.value) return;
  const body = text.value.trim();
  // The target is fixed before the textarea takes focus. In particular, a gutter click
  // must keep the line it named even if Monaco's cursor or the selected file moves.
  saving.value = true;
  try {
    await props.store.addNote(body, props.target?.path ?? null, props.target?.line ?? null);
    emit("close");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="target" class="capture" @click.self="$emit('close')">
    <form class="panel" role="dialog" aria-modal="true" aria-labelledby="note-target" @submit.prevent="submit">
      <label id="note-target" class="context" for="note-text">
        Note on
        <b>{{ target.path ?? "this pull request" }}</b>
        <template v-if="target.line !== null"> · line {{ target.line }}</template>
      </label>
      <!-- Enter submits, Shift+Enter breaks the line: capture must cost one keystroke. -->
      <textarea
        ref="box"
        id="note-text"
        v-model="text"
        class="note"
        rows="12"
        aria-describedby="note-capture-hint"
        placeholder="What needs answering or changing here?"
        @keydown.enter.exact.prevent="submit"
        @keydown.esc.prevent="$emit('close')"
      />
      <div class="footer">
        <div id="note-capture-hint" class="hint">
          <kbd>Enter</kbd> to save · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>Esc</kbd> to cancel
        </div>
        <div class="actions">
          <button type="button" class="cancel" @click="$emit('close')">Cancel</button>
          <button type="submit" class="save" :disabled="!canSave">
            {{ saving ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.capture { position: fixed; inset: 0; background: var(--overlay-background); display: flex; align-items: center; justify-content: center; padding: clamp(16px, 8vh, 72px) clamp(16px, 5vw, 72px); z-index: 50; }
.panel { width: min(960px, 100%); max-height: 100%; background: var(--panel-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-lg); padding: 20px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 18px 50px var(--workbench-shadow); }
.context { font-size: 13px; color: var(--faint-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.context b { color: var(--workbench-foreground); font-weight: 600; }
.note { width: 100%; height: clamp(180px, 42vh, 420px); min-height: 120px; max-height: calc(100vh - 160px); background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-md); color: var(--workbench-foreground); caret-color: var(--accent); font: inherit; font-size: 14px; line-height: 1.6; padding: 14px 16px; resize: vertical; }
.note::selection { background: var(--selection-background); }
.note:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.hint { font-size: 11px; color: var(--faint-foreground); }
kbd { font: 10.5px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-sm); padding: 1px 5px; }
.actions { display: flex; flex: none; gap: 8px; }
button { height: 30px; padding: 0 14px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--input-background); color: var(--workbench-foreground); font: inherit; font-size: 12px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button:disabled { opacity: .55; cursor: default; }
.save { border-color: var(--accent); background: var(--accent); color: var(--accent-foreground); font-weight: 600; }

@media (max-width: 620px) {
  .footer { align-items: flex-end; flex-direction: column; }
}
</style>
