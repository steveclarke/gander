<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import {
  DEFAULT_APP_SETTINGS,
  effectiveTreeTypography,
} from "../../../settings.js";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { useDebouncedSave } from "../composables/use-debounced-save.js";
import SettingsField from "./SettingsField.vue";

const props = defineProps<{ store: EditorSettingsStore }>();
const emit = defineEmits<{ saved: [success: boolean] }>();

const fontFamily = shallowRef(props.store.settings.workbench.tree.fontFamily);
const fontSize = shallowRef<number | string>(props.store.settings.workbench.tree.fontSize);
const inheritEditorTypography = shallowRef(
  props.store.settings.workbench.tree.inheritEditorTypography,
);
const localError = shallowRef<string | null>(null);

watch(
  () => props.store.settings.workbench.tree,
  (tree) => {
    fontFamily.value = tree.fontFamily;
    fontSize.value = tree.fontSize;
    inheritEditorTypography.value = tree.inheritEditorTypography;
  },
);

const previewTypography = computed(() => effectiveTreeTypography({
  ...props.store.settings,
  workbench: {
    ...props.store.settings.workbench,
    tree: {
      fontFamily: fontFamily.value.trim() || DEFAULT_APP_SETTINGS.workbench.tree.fontFamily,
      fontSize: Math.min(100, Math.max(6, Number(fontSize.value) || 13)),
      inheritEditorTypography: inheritEditorTypography.value,
    },
  },
}));

const previewStyle = computed(() => ({
  fontFamily: previewTypography.value.fontFamily,
  fontSize: `${previewTypography.value.fontSize}px`,
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
    workbench: {
      ...props.store.settings.workbench,
      tree: {
        fontFamily: family,
        fontSize: size,
        inheritEditorTypography: inheritEditorTypography.value,
      },
    },
  }));
}

const autoSave = useDebouncedSave(save);

// The checkbox is one deliberate click, not a keystroke in a stream of them: it saves at
// once, and takes any typing still waiting with it.
async function saveInheritance(): Promise<void> {
  autoSave.cancel();
  await save();
}

async function reset(): Promise<void> {
  autoSave.cancel();
  const tree = DEFAULT_APP_SETTINGS.workbench.tree;
  fontFamily.value = tree.fontFamily;
  fontSize.value = tree.fontSize;
  inheritEditorTypography.value = tree.inheritEditorTypography;
  localError.value = null;
  emit("saved", await props.store.update({
    ...props.store.settings,
    workbench: { ...props.store.settings.workbench, tree },
  }));
}
</script>

<template>
  <section class="settings-section tree-typography" aria-labelledby="tree-typography-title">
    <div class="settings-section-heading">
      <div>
        <h3 id="tree-typography-title" class="settings-section-title">File tree typography</h3>
        <p class="settings-description">Controls filenames and folders in the review tree.</p>
      </div>
      <button class="settings-reset" type="button" :disabled="store.busy" @click="reset">Use default</button>
    </div>

    <label class="inherit-setting">
      <input
        v-model="inheritEditorTypography"
        name="workbench.tree.inheritEditorTypography"
        type="checkbox"
        :disabled="store.busy"
        @change="saveInheritance"
      >
      <span>
        Inherit editor typography
        <small>Use <code class="settings-code">editor.fontFamily</code> and <code class="settings-code">editor.fontSize</code> for the tree.</small>
      </span>
    </label>

    <SettingsField
      id="tree-font-family"
      name="workbench.tree.fontFamily"
      label="Font family"
      :model-value="fontFamily"
      :disabled="store.busy || inheritEditorTypography"
      @update:model-value="fontFamily = $event; autoSave.schedule()"
      @change="autoSave.flush"
    >
      <template #description>
        Controls <code class="settings-code">workbench.tree.fontFamily</code> when inheritance is off.
      </template>
    </SettingsField>

    <SettingsField
      id="tree-font-size"
      name="workbench.tree.fontSize"
      label="Font size"
      type="number"
      min="6"
      max="100"
      step="0.5"
      :model-value="fontSize"
      :disabled="store.busy || inheritEditorTypography"
      @update:model-value="fontSize = $event; autoSave.schedule()"
      @change="autoSave.flush"
    >
      <template #description>
        Controls <code class="settings-code">workbench.tree.fontSize</code> in pixels when inheritance is off.
      </template>
      <template #unit>px</template>
    </SettingsField>

    <div class="settings-field preview-setting">
      <p id="tree-preview-label" class="settings-label">Preview</p>
      <div class="preview" aria-labelledby="tree-preview-label" :style="previewStyle">
        <span>src</span><span>components</span><span>FileTree.vue</span>
      </div>
    </div>

    <p v-if="localError" class="settings-error" role="alert">{{ localError }}</p>
  </section>
</template>

<style scoped>
.inherit-setting { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 24px; color: var(--workbench-foreground); font-size: 13px; cursor: pointer; }
.inherit-setting input { margin-top: 2px; accent-color: var(--accent); }
.inherit-setting small { display: block; margin-top: 2px; color: var(--faint-foreground); font-size: 12px; }
.preview-setting { margin-top: 28px; }
.preview { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow: hidden; margin-top: 8px; padding: 12px 14px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--input-background); color: var(--workbench-foreground); white-space: nowrap; }
.preview span:nth-child(2) { padding-left: 16px; }
.preview span:nth-child(3) { padding-left: 32px; }
</style>
