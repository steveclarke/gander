<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { DEFAULT_APP_SETTINGS } from "../../../settings.js";

const props = defineProps<{ store: EditorSettingsStore }>();

const fontFamily = shallowRef(props.store.settings.editor.fontFamily);
const fontSize = shallowRef<number | string>(props.store.settings.editor.fontSize);
const localError = shallowRef<string | null>(null);
const saved = shallowRef(false);

watch(
  () => props.store.settings.editor,
  (editor) => {
    fontFamily.value = editor.fontFamily;
    fontSize.value = editor.fontSize;
  },
);

const previewStyle = computed(() => ({
  fontFamily: fontFamily.value.trim() || DEFAULT_APP_SETTINGS.editor.fontFamily,
  fontSize: `${Math.min(100, Math.max(6, Number(fontSize.value) || 16))}px`,
}));

async function reset(): Promise<void> {
  fontFamily.value = DEFAULT_APP_SETTINGS.editor.fontFamily;
  fontSize.value = DEFAULT_APP_SETTINGS.editor.fontSize;
  localError.value = null;
  saved.value = await props.store.update({
    ...props.store.settings,
    editor: DEFAULT_APP_SETTINGS.editor,
  });
}

async function save(): Promise<void> {
  const family = fontFamily.value.trim();
  const size = Number(fontSize.value);
  saved.value = false;
  if (!family) {
    localError.value = "Enter at least one font family.";
    return;
  }
  if (!Number.isFinite(size) || size < 6 || size > 100) {
    localError.value = "Enter a font size from 6 to 100.";
    return;
  }

  localError.value = null;
  saved.value = await props.store.update({
    ...props.store.settings,
    editor: { fontFamily: family, fontSize: size },
  });
}
</script>

<template>
  <form class="settings" role="dialog" aria-labelledby="editor-settings-title" @submit.prevent="save">
    <div class="heading">
      <div>
        <h2 id="editor-settings-title">Editor appearance</h2>
        <p>Applies to diffs and full-file code views.</p>
      </div>
      <button class="reset" type="button" :disabled="store.busy" @click="reset">Use defaults</button>
    </div>

    <label for="editor-font-family">Font family</label>
    <input
      id="editor-font-family"
      v-model="fontFamily"
      name="editor.fontFamily"
      spellcheck="false"
      autocomplete="off"
    />
    <p class="hint">Keep fonts in fallback order, separated by commas.</p>

    <label for="editor-font-size">Font size</label>
    <div class="size-row">
      <input
        id="editor-font-size"
        v-model.number="fontSize"
        name="editor.fontSize"
        type="number"
        min="6"
        max="100"
        step="0.5"
      />
      <span>px</span>
    </div>

    <pre class="preview" :style="previewStyle"><code>const review = "ready";</code></pre>

    <div class="actions">
      <p v-if="localError || store.error" class="message error" role="alert">{{ localError || store.error }}</p>
      <p v-else-if="saved" class="message saved" role="status">Saved</p>
      <span v-else />
      <button class="save" type="submit" :disabled="store.busy">{{ store.busy ? "Saving…" : "Save" }}</button>
    </div>
  </form>
</template>

<style scoped>
.settings { display: grid; gap: 8px; padding: 16px; }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 6px; }
.heading h2 { color: var(--text); font-size: 14px; font-weight: 650; }
.heading p, .hint { color: var(--faint); font-size: 11.5px; }
.reset { border: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; font-size: 11.5px; white-space: nowrap; }
.reset:disabled { cursor: default; opacity: .55; }
label { color: var(--dim); font-size: 11.5px; font-weight: 600; }
input {
  width: 100%; min-width: 0; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 6px;
  outline: none; background: #14161b; color: var(--text); font: 13px/1.4 var(--mono);
}
input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(77, 159, 236, .16); }
.size-row { display: flex; align-items: center; gap: 8px; width: 110px; color: var(--faint); }
.preview {
  min-width: 0; overflow: hidden; margin-top: 6px; padding: 12px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg);
  color: var(--text); line-height: 1.5; white-space: nowrap;
}
.preview code { font: inherit; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 30px; margin-top: 2px; }
.message { min-width: 0; font-size: 11.5px; overflow-wrap: anywhere; }
.error { color: var(--red); }
.saved { color: var(--green); }
.save {
  flex: none; padding: 6px 14px; border: 1px solid var(--accent); border-radius: 6px;
  background: rgba(77, 159, 236, .14); color: var(--text); cursor: pointer; font: inherit;
}
.save:hover:not(:disabled) { background: rgba(77, 159, 236, .24); }
.save:disabled { cursor: default; opacity: .55; }
</style>
