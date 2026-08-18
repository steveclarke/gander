<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef, watch } from "vue";
import type { Store } from "../store.js";
import type { QuestionTarget } from "../selection.js";

const props = defineProps<{ store: Store; target: QuestionTarget | null }>();
const emit = defineEmits<{ close: [] }>();

const text = shallowRef("");
const box = useTemplateRef<HTMLTextAreaElement>("box");

watch(() => props.target, async (target) => {
  if (target === null) return;
  text.value = "";
  await nextTick();
  box.value?.focus();
});

async function submit(): Promise<void> {
  const body = text.value.trim();
  if (!body) return;
  // The target is fixed before the textarea takes focus. In particular, a gutter click
  // must keep the line it named even if Monaco's cursor or the selected file moves.
  await props.store.addQuestion(body, props.target?.path ?? null, props.target?.line ?? null);
  emit("close");
}
</script>

<template>
  <div v-if="target" class="capture" @click.self="$emit('close')">
    <form class="panel" role="dialog" aria-modal="true" aria-labelledby="question-target" @submit.prevent="submit">
      <label id="question-target" class="context" for="question-text">
        Question on
        <b>{{ target.path ?? "this pull request" }}</b>
        <template v-if="target.line !== null"> · line {{ target.line }}</template>
      </label>
      <!-- Enter submits, Shift+Enter breaks the line: capture must cost one keystroke. -->
      <textarea
        ref="box"
        id="question-text"
        v-model="text"
        class="question"
        rows="12"
        aria-describedby="question-capture-hint"
        placeholder="What needs answering or changing here?"
        @keydown.enter.exact.prevent="submit"
        @keydown.esc.prevent="$emit('close')"
      />
      <div id="question-capture-hint" class="hint">
        <kbd>Enter</kbd> to save · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>Esc</kbd> to cancel
      </div>
    </form>
  </div>
</template>

<style scoped>
.capture { position: fixed; inset: 0; background: var(--overlay-background); display: flex; align-items: center; justify-content: center; padding: clamp(16px, 8vh, 72px) clamp(16px, 5vw, 72px); z-index: 50; }
.panel { width: min(960px, 100%); max-height: 100%; background: var(--panel-background); border: 1px solid var(--workbench-border); border-radius: 10px; padding: 20px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 18px 50px var(--workbench-shadow); }
.context { font-size: 13px; color: var(--faint-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.context b { color: var(--workbench-foreground); font-weight: 600; }
.question { width: 100%; height: clamp(180px, 42vh, 420px); min-height: 120px; max-height: calc(100vh - 160px); background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: 7px; color: var(--workbench-foreground); caret-color: var(--accent); font: inherit; font-size: 14px; line-height: 1.6; padding: 14px 16px; resize: vertical; }
.question::selection { background: var(--selection-background); }
.question:focus { outline: 2px solid var(--focus-ring); outline-offset: 1px; border-color: var(--accent); }
.hint { font-size: 11px; color: var(--faint-foreground); }
kbd { font: 10.5px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: 4px; padding: 1px 5px; }
</style>
