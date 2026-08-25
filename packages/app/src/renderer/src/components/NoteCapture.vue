<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from "vue";
import type { Store } from "../store.js";
import { basename } from "../paths.js";
import type { NoteTarget } from "../selection.js";

const props = withDefaults(defineProps<{
  store: Store;
  target: NoteTarget;
  dock?: "right" | "bottom";
  focusRequest?: number;
}>(), {
  dock: "right",
  focusRequest: 0,
});
const emit = defineEmits<{ close: []; navigate: [target: NoteTarget] }>();
const text = defineModel<string>({ default: "" });

const saving = shallowRef(false);
const canSave = computed(() => text.value.trim().length > 0 && !saving.value);
const targetName = computed(() => props.target.path === null ? "This pull request" : basename(props.target.path));
const targetLocation = computed(() => props.target.line === null ? targetName.value : `${targetName.value}:${props.target.line}`);
const targetDetail = computed(() => props.target.path ?? "Applies to the entire pull request");
const showTargetDetail = computed(() => props.target.path === null || props.target.path !== targetName.value);
const box = useTemplateRef<HTMLTextAreaElement>("box");

watch(() => props.focusRequest, async () => {
  await nextTick();
  box.value?.focus();
}, { immediate: true });

async function submit(): Promise<void> {
  if (!canSave.value) return;
  const body = text.value.trim();
  // The target is fixed before the textarea takes focus. In particular, a gutter click
  // must keep the line it named even if Monaco's cursor or the selected file moves.
  saving.value = true;
  try {
    await props.store.addNote(body, props.target.path, props.target.line);
    emit("close");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="capture" :class="dock" role="form" aria-labelledby="note-composer-title" @submit.prevent="submit">
    <div class="context">
      <h3 id="note-composer-title">New note</h3>
      <button
        v-if="target.path"
        type="button"
        class="target"
        :title="`Return to ${target.path}${target.line === null ? '' : `:${target.line}`}`"
        @click="emit('navigate', target)"
      >
        {{ targetLocation }}
      </button>
      <span v-else class="target-label">{{ targetLocation }}</span>
      <span v-if="showTargetDetail" class="path" :title="targetDetail">{{ targetDetail }}</span>
    </div>
    <div class="writing">
      <!-- Enter submits, Shift+Enter breaks the line: capture must cost one keystroke. -->
      <textarea
        ref="box"
        id="note-text"
        v-model="text"
        class="note"
        rows="4"
        aria-label="Note text"
        aria-describedby="note-capture-hint"
        placeholder="What needs answering or changing here?"
        @keydown.enter.exact.prevent="submit"
        @keydown.esc.prevent="$emit('close')"
      />
      <div id="note-capture-hint" class="hint">
        <kbd>Enter</kbd> save · <kbd>⇧ Enter</kbd> new line · <kbd>Esc</kbd> cancel
      </div>
    </div>
    <div class="actions">
      <button type="button" class="cancel" @click="emit('close')">Cancel</button>
      <button type="submit" class="save" :disabled="!canSave">
        {{ saving ? "Saving…" : "Save" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.capture { display: flex; flex: none; flex-direction: column; gap: 9px; padding: 11px 10px 10px; border-bottom: 1px solid var(--workbench-border); background: color-mix(in srgb, var(--accent) 4%, var(--panel-background)); }
.context { display: grid; min-width: 0; grid-template-columns: minmax(0, auto) 1fr; align-items: baseline; gap: 4px 8px; }
.context h3 { grid-column: 1 / -1; margin: 0; color: var(--workbench-foreground); font-size: 12px; font-weight: 650; }
.target, .target-label { min-width: 0; color: var(--accent); font: 600 11.5px var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.target { width: fit-content; max-width: 100%; padding: 0; border: 0; background: none; cursor: pointer; text-align: left; }
.target:hover { text-decoration: underline; text-underline-offset: 3px; }
.path { min-width: 0; overflow: hidden; color: var(--faint-foreground); font: 10.5px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.writing { min-width: 0; }
.note { box-sizing: border-box; width: 100%; min-height: 82px; max-height: 180px; background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-md); color: var(--workbench-foreground); caret-color: var(--accent); font: inherit; font-size: 12.5px; line-height: 1.5; padding: 8px 9px; resize: vertical; }
.note::selection { background: var(--selection-background); }
.note:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.hint { margin-top: 5px; color: var(--faint-foreground); font-size: 9.5px; line-height: 1.4; }
kbd { font: 9px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-sm); padding: 1px 3px; }
.actions { display: flex; flex: none; gap: 8px; }
.actions button { height: 28px; padding: 0 11px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--input-background); color: var(--workbench-foreground); font: inherit; font-size: 11px; cursor: pointer; }
.actions button:hover:not(:disabled) { border-color: var(--accent); }
.target:focus-visible, .actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.actions button:disabled { opacity: .55; cursor: default; }
.save { border-color: var(--accent); background: var(--accent); color: var(--accent-foreground); font-weight: 600; }

@container notes (min-width: 620px) {
  .capture.bottom { display: grid; grid-template-columns: minmax(150px, .32fr) minmax(260px, 1fr) auto; align-items: end; gap: 10px; }
  .capture.bottom .context { display: flex; flex-direction: column; align-self: stretch; justify-content: center; gap: 4px; }
  .capture.bottom .context h3 { margin-bottom: 2px; }
  .capture.bottom .note { min-height: 64px; height: 64px; resize: none; }
}
</style>
