<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { Store } from "../store.js";
import { currentLine } from "../selection.js";

const props = defineProps<{ store: Store; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const text = ref("");
const box = ref<HTMLTextAreaElement | null>(null);
// Held at the moment the box opens: focusing the textarea takes the cursor out of the
// editor, and the line the reader was on is the one the question is about.
const capturedLine = ref<number | null>(null);

watch(() => props.open, async (open) => {
  if (!open) return;
  capturedLine.value = props.store.selectedPath === null ? null : currentLine.value;
  text.value = "";
  await nextTick();
  box.value?.focus();
});

async function submit(): Promise<void> {
  const body = text.value.trim();
  if (!body) return;
  // Captured against the file being read. A question with no file selected is a
  // note about the pull request as a whole.
  await props.store.addQuestion(body, props.store.selectedPath, capturedLine.value);
  emit("close");
}
</script>

<template>
  <div v-if="open" class="capture" @click.self="$emit('close')">
    <form class="panel" @submit.prevent="submit">
      <label>
        Question on
        <b>{{ store.selectedPath ?? "this pull request" }}</b>
        <template v-if="capturedLine !== null"> · line {{ capturedLine }}</template>
      </label>
      <!-- Enter submits, Shift+Enter breaks the line: capture must cost one keystroke. -->
      <textarea
        ref="box"
        v-model="text"
        rows="3"
        placeholder="What needs answering or changing here?"
        @keydown.enter.exact.prevent="submit"
        @keydown.esc.prevent="$emit('close')"
      />
      <div class="hint">
        <kbd>Enter</kbd> to save · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>Esc</kbd> to cancel
      </div>
    </form>
  </div>
</template>

<style scoped>
.capture { position: fixed; inset: 0; background: var(--overlay-background); display: flex; align-items: flex-start; justify-content: center; padding-top: 14vh; z-index: 50; }
.panel { width: min(620px, 90vw); background: var(--panel-background); border: 1px solid var(--workbench-border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 18px 50px var(--workbench-shadow); }
label { font-size: 12px; color: var(--faint-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
label b { color: var(--workbench-foreground); font-weight: 600; }
textarea { background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: 7px; color: var(--workbench-foreground); font: inherit; font-size: 13px; padding: 9px 11px; resize: vertical; }
textarea:focus { outline: none; border-color: var(--accent); }
.hint { font-size: 11px; color: var(--faint-foreground); }
kbd { font: 10.5px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: 4px; padding: 1px 5px; }
</style>
