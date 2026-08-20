<script setup lang="ts">
import * as monaco from "monaco-editor";
import { onMounted, useTemplateRef, watch } from "vue";
import type { EditorSettings } from "../../../settings.js";
import { editorFontOptions } from "../editor-options.js";
import { useMonacoSurface } from "../composables/use-monaco-surface.js";

const props = defineProps<{ modelValue: string; editorSettings: EditorSettings }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const host = useTemplateRef<HTMLElement>("host");

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
let settingFromParent = false;

function dispose(): void {
  editor?.dispose();
  model?.dispose();
  editor = null;
  model = null;
}

useMonacoSurface({ settings: () => props.editorSettings, editor: () => editor, dispose });

onMounted(() => {
  if (!host.value) return;
  model = monaco.editor.createModel(
    props.modelValue,
    "json",
    monaco.Uri.parse("inmemory://gander/settings.json"),
  );
  editor = monaco.editor.create(host.value, {
    model,
    automaticLayout: true,
    ariaLabel: "Settings JSON editor",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: "on",
    ...editorFontOptions(props.editorSettings),
  });
  editor.onDidChangeModelContent(() => {
    if (!settingFromParent && model) emit("update:modelValue", model.getValue());
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!model || model.getValue() === value) return;
    settingFromParent = true;
    model.setValue(value);
    settingFromParent = false;
  },
);
</script>

<template>
  <div ref="host" class="settings-json-editor" data-app-typing="true" />
</template>

<style scoped>
.settings-json-editor { width: 100%; height: 100%; min-width: 0; min-height: 0; }
</style>
