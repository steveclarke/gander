<script setup lang="ts">
import * as monaco from "monaco-editor";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { languageForPath } from "../languages.js";
import { setupMonacoWorkers } from "../monaco.js";
import type { Store } from "../store.js";

const props = defineProps<{ store: Store }>();
const host = ref<HTMLElement | null>(null);
const view = ref<"diff" | "full">("diff");
let editor: monaco.editor.IStandaloneDiffEditor | monaco.editor.IStandaloneCodeEditor | null = null;
let models: monaco.editor.ITextModel[] = [];

const current = computed(
  () => props.store.view?.files.find((f) => f.path === props.store.selectedPath) ?? null,
);

const dirName = computed(() => {
  const parts = current.value?.path.split("/") ?? [];
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
});
const baseName = computed(() => current.value?.path.split("/").pop() ?? "");

function dispose(): void {
  editor?.dispose();
  editor = null;
  for (const model of models) model.dispose();
  models = [];
}

function render(): void {
  dispose();
  const file = current.value;
  if (!host.value || !file) return;
  const lang = languageForPath(file.path);
  if (view.value === "diff") {
    const original = monaco.editor.createModel(file.baseContent ?? "", lang);
    const modified = monaco.editor.createModel(file.headContent ?? "", lang);
    models = [original, modified];
    const diff = monaco.editor.createDiffEditor(host.value, {
      renderSideBySide: false,
      readOnly: true,
      automaticLayout: true,
      hideUnchangedRegions: { enabled: true },
      theme: "vs-dark",
    });
    diff.setModel({ original, modified });
    editor = diff;
  } else {
    const model = monaco.editor.createModel(file.headContent ?? "", lang);
    models = [model];
    editor = monaco.editor.create(host.value, {
      model,
      readOnly: true,
      automaticLayout: true,
      theme: "vs-dark",
    });
  }
}

onMounted(() => {
  setupMonacoWorkers();
  render();
});
watch([current, view], render);
onBeforeUnmount(dispose);
</script>

<template>
  <section v-if="current" class="pane">
    <header class="filehead">
      <span class="path"><span class="dir">{{ dirName }}</span>{{ baseName }}</span>
      <div class="tabs">
        <button :class="{ active: view === 'diff' }" @click="view = 'diff'">vs main</button>
        <button :class="{ active: view === 'full' }" @click="view = 'full'">full file</button>
      </div>
      <button
        class="check"
        :class="{ on: current.checked }"
        @click="store.setChecked(current.path, !current.checked)"
      >
        {{ current.checked ? "✓ Reviewed" : "Mark reviewed" }}
      </button>
    </header>
    <div ref="host" class="editor" />
  </section>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.filehead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
}
.path {
  font: 12.5px var(--mono);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.path .dir {
  color: var(--faint);
}
.tabs {
  margin-left: auto;
  display: flex;
  gap: 2px;
  background: #14161b;
  border-radius: 7px;
  padding: 2px;
  flex: none;
}
.tabs button {
  background: none;
  border: none;
  color: var(--dim);
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
}
.tabs button.active {
  background: #2c3340;
  color: var(--text);
}
.check {
  flex: none;
  border: 1px solid var(--border);
  background: #22262e;
  color: var(--text);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.check.on {
  border-color: var(--green);
  color: var(--green);
  background: rgba(63, 185, 80, 0.15);
}
.editor {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
