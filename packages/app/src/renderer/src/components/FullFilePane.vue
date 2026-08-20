<script setup lang="ts">
import * as monaco from "monaco-editor";
import { computed, onMounted, ref, watch } from "vue";
import type { LocalFile } from "@gander/shared";
import type { EditorSettings } from "../../../settings.js";
import { languageForPath } from "../languages.js";
import { basename, directoryPrefix } from "../paths.js";
import { codeEditorOptions } from "../editor-options.js";
import { useMonacoSurface } from "../composables/use-monaco-surface.js";

const props = defineProps<{ file: LocalFile | null; editorSettings: EditorSettings }>();
const host = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
const fileName = computed(() => props.file === null ? "" : basename(props.file.path));
const directory = computed(() => props.file === null ? "" : directoryPrefix(props.file.path));
function dispose(): void { editor?.dispose(); model?.dispose(); editor = null; model = null; }
function render(): void {
  dispose();
  if (!host.value || !props.file || props.file.binary) return;
  model = monaco.editor.createModel(props.file.content ?? "", languageForPath(props.file.path));
  editor = monaco.editor.create(host.value, { model, ...codeEditorOptions(props.editorSettings) });
}
useMonacoSurface({ settings: () => props.editorSettings, editor: () => editor, dispose });
onMounted(render);
// flush: "post" — the template swaps the `host` element in and out with the file itself,
// so render() has to run after Vue has patched the DOM.
watch(() => props.file ? `${props.file.path}#${props.file.hash}` : null, render, { flush: "post" });
</script>

<template>
  <section class="pane">
    <header v-if="file"><span class="directory">{{ directory }}</span>{{ fileName }}</header>
    <div v-if="file?.binary" class="empty">Binary file — preview is not available in Explorer.</div>
    <div v-else-if="!file" class="empty">Select a file to read it.</div>
    <div v-else ref="host" class="editor" />
  </section>
</template>

<style scoped>
.pane { height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
header { height: 35px; box-sizing: border-box; display: flex; align-items: center; padding-inline: 14px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); font: 12.5px var(--mono); }
.directory { color: var(--faint-foreground); }
.editor { flex: 1; min-height: 0; }
.empty { flex: 1; display: grid; place-items: center; color: var(--faint-foreground); }
</style>
