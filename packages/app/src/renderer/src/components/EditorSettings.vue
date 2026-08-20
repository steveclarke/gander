<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { DEFAULT_APP_SETTINGS } from "../../../settings.js";
import { useDebouncedSave } from "../composables/use-debounced-save.js";
import SettingsField from "./SettingsField.vue";

const props = defineProps<{ store: EditorSettingsStore }>();
const emit = defineEmits<{ saved: [success: boolean] }>();

const fontFamily = shallowRef(props.store.settings.editor.fontFamily);
const fontSize = shallowRef<number | string>(props.store.settings.editor.fontSize);
const localError = shallowRef<string | null>(null);

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

async function save(): Promise<void> {
  const family = fontFamily.value.trim();
  const size = Number(fontSize.value);
  if (!family) {
    localError.value = "Enter at least one font family.";
    return;
  }
  if (!Number.isFinite(size) || size < 6 || size > 100) {
    localError.value = "Enter a font size from 6 to 100.";
    return;
  }

  localError.value = null;
  emit("saved", await props.store.update({
    ...props.store.settings,
    editor: { fontFamily: family, fontSize: size },
  }));
}

const autoSave = useDebouncedSave(save);

async function reset(): Promise<void> {
  autoSave.cancel();
  fontFamily.value = DEFAULT_APP_SETTINGS.editor.fontFamily;
  fontSize.value = DEFAULT_APP_SETTINGS.editor.fontSize;
  localError.value = null;
  emit("saved", await props.store.update({
    ...props.store.settings,
    editor: DEFAULT_APP_SETTINGS.editor,
  }));
}
</script>

<template>
  <section class="settings-page editor-settings" aria-labelledby="editor-settings-title">
    <header class="settings-page-heading">
      <div>
        <h2 id="editor-settings-title" class="settings-page-title">Editor</h2>
        <p class="settings-description">Typography for diffs, full-file views, and other code surfaces.</p>
      </div>
      <button class="settings-reset" type="button" :disabled="store.busy" @click="reset">Use defaults</button>
    </header>

    <SettingsField
      id="editor-font-family"
      name="editor.fontFamily"
      label="Font family"
      :model-value="fontFamily"
      :disabled="store.busy"
      @update:model-value="fontFamily = $event; autoSave.schedule()"
      @change="autoSave.flush"
    >
      <template #description>
        Controls <code class="settings-code">editor.fontFamily</code>. Keep fonts in fallback order, separated by commas.
      </template>
    </SettingsField>

    <SettingsField
      id="editor-font-size"
      name="editor.fontSize"
      label="Font size"
      type="number"
      min="6"
      max="100"
      step="0.5"
      :model-value="fontSize"
      :disabled="store.busy"
      @update:model-value="fontSize = $event; autoSave.schedule()"
      @change="autoSave.flush"
    >
      <template #description>
        Controls <code class="settings-code">editor.fontSize</code> in pixels. Use a value from 6 to 100.
      </template>
      <template #unit>px</template>
    </SettingsField>

    <div class="settings-field preview-setting">
      <p id="editor-preview-label" class="settings-label">Preview</p>
      <pre class="preview" aria-labelledby="editor-preview-label" :style="previewStyle"><code>const review = "ready";</code></pre>
    </div>

    <p v-if="localError" class="settings-error error" role="alert">{{ localError }}</p>
  </section>
</template>

<style scoped>
.editor-settings { --settings-field-gap: 26px; }
.preview-setting { margin-top: 34px; }
.preview {
  min-width: 0; overflow: hidden; margin-top: 8px; padding: 14px;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--input-background);
  color: var(--workbench-foreground); line-height: 1.5; white-space: nowrap;
}
.preview code { color: inherit; font: inherit; }
.error { max-width: 820px; }
</style>
