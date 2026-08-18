<script setup lang="ts">
import * as monaco from "monaco-editor";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { languageForPath } from "../languages.js";
import { setupMonacoWorkers } from "../monaco.js";
import type { Store } from "../store.js";
import { currentLine, pendingReveal } from "../selection.js";
import { Check, FileDiff, FileText, TriangleAlert } from "lucide-vue-next";

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
// The branch the pull request targets — "master" as often as "main".
const baseRef = computed(() => props.store.view?.pr.baseRef ?? "the base branch");

// git.ts hashes a binary blob's raw bytes but withholds its content, so `content === null`
// paired with a real hash (as opposed to a null hash, which means "absent at this revision")
// is how a binary file is told apart from a file that simply doesn't exist at that side of
// the diff. See git.ts's ShowFileResult doc comment for the full reasoning.
const baseBinary = computed(() => current.value !== null && current.value.baseContent === null && current.value.baseHash !== null);
const headBinary = computed(() => current.value !== null && current.value.headContent === null && current.value.headHash !== null);
const isBinary = computed(() => baseBinary.value || headBinary.value);

/** The editor holding the head revision: the diff editor's right-hand side, or the full file. */
function headEditor(): monaco.editor.ICodeEditor | null {
  if (!editor) return null;
  return "getModifiedEditor" in editor ? editor.getModifiedEditor() : editor;
}

function trackCursor(): void {
  const ed = headEditor();
  if (!ed) return;
  currentLine.value = ed.getPosition()?.lineNumber ?? null;
  ed.onDidChangeCursorPosition((e) => { currentLine.value = e.position.lineNumber; });
}

function dispose(): void {
  editor?.dispose();
  editor = null;
  // A line number from a file that is no longer on screen would stamp the next
  // question with a line the reader never looked at.
  currentLine.value = null;
  for (const model of models) model.dispose();
  models = [];
}

function render(): void {
  dispose();
  const file = current.value;
  if (!file || isBinary.value) return; // no `host` element in the DOM for a binary file — see template
  if (!host.value) return;
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
    trackCursor();
  } else {
    const model = monaco.editor.createModel(file.headContent ?? "", lang);
    models = [model];
    editor = monaco.editor.create(host.value, {
      model,
      readOnly: true,
      automaticLayout: true,
      theme: "vs-dark",
    });
    trackCursor();
  }
  reveal();
}

// The editor must only be torn down and rebuilt when the content it displays actually
// changes — not on every store.view reassignment, which the 30s poll does unconditionally
// and every setChecked/setCheckedMany does too (IPC returns freshly cloned objects, so
// `current` is a new object identity even when nothing the reviewer is looking at changed).
// Rebuilding on identity churn resets scroll position, folded regions, and selection in the
// middle of the diff the reviewer is reading — the core reading loop of the product.
//
// The key below collapses to a sentinel when there's no selected file (or it's binary, where
// `render()` is a no-op and there's no `host` element to mount into), and otherwise names
// exactly the three things that change what should be on screen: which file, its content at
// each revision (baseHash/headHash — not the object identity of the PrFile), and which tab
// (diff vs full file). Reasoned through each trigger:
//   - 30s poll, unchanged content -> same path/hashes/tab -> key unchanged -> no rebuild.
//   - setChecked / setCheckedMany -> only `checked`/`changedSince` differ -> key unchanged.
//   - the PR's head moves and this file's content changes -> baseHash or headHash differs
//     -> key changes -> rebuild (correct: there's new content to show).
//   - reviewer clicks a different file in the tree -> path differs -> rebuild.
//   - reviewer switches "vs main" <-> "full file" -> tab differs -> rebuild.
//   - the selected file drops out of the PR view (e.g. a refresh landing on a smaller diff)
//     -> current becomes null -> key becomes the sentinel -> dispose() runs, no crash.
const renderKey = computed(() => {
  const file = current.value;
  if (!file) return null;
  return `${file.path}#${file.baseHash ?? ""}#${file.headHash ?? ""}#${view.value}`;
});

onMounted(() => {
  setupMonacoWorkers();
  render();
});
// flush: "post" — the binary/text split below is a v-if/v-else, so the `host` element is
// created or destroyed by that same content change. The default pre-flush timing would run
// render() before Vue patches the DOM, handing it a stale or absent host element.
/** Jump to a line the reader picked in the questions drawer, unfolding it if it is hidden. */
function reveal(): void {
  const line = pendingReveal.value;
  const ed = headEditor();
  if (line === null || !ed) return;
  pendingReveal.value = null;
  ed.revealLineInCenter(line);
  ed.setPosition({ lineNumber: line, column: 1 });
  ed.focus();
}

watch(renderKey, render, { flush: "post" });
// A jump into the file already on screen needs no rebuild; render() handles the case
// where the drawer also switched files, by calling reveal() once the editor exists.
watch(pendingReveal, (line) => { if (line !== null) reveal(); }, { flush: "post" });
onBeforeUnmount(dispose);
</script>

<template>
  <section v-if="current" class="pane">
    <header class="filehead">
      <span class="path"><span class="dir">{{ dirName }}</span>{{ baseName }}</span>
      <div class="tabs" role="tablist">
        <button
          role="tab"
          :aria-selected="view === 'diff'"
          :class="{ active: view === 'diff' }"
          :aria-label="`Changes against ${baseRef}`"
          :title="`Changes against ${baseRef}`"
          @click="view = 'diff'"
        >
          <FileDiff :size="15" />
        </button>
        <button
          role="tab"
          :aria-selected="view === 'full'"
          :class="{ active: view === 'full' }"
          aria-label="Full file"
          title="Full file"
          @click="view = 'full'"
        >
          <FileText :size="15" />
        </button>
      </div>
      <button
        class="check"
        :class="{ on: current.checked }"
        @click="store.setChecked(current.path, !current.checked)"
      >
        <Check v-if="current.checked" :size="14" :stroke-width="3" />
        <span>{{ current.checked ? "Reviewed" : "Mark reviewed" }}</span>
      </button>
    </header>
    <div v-if="current.changedSince" class="banner">
      <TriangleAlert :size="14" />
      <span>Changed since your review — un-checked automatically. Re-review and mark again.</span>
    </div>
    <div v-if="isBinary" class="binary-note">Binary file — diff cannot be displayed.</div>
    <div v-else ref="host" class="editor" />
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  background: none;
  border: none;
  color: var(--dim);
  border-radius: 5px;
  cursor: pointer;
}
.tabs button.active {
  background: #2c3340;
  color: var(--text);
}
.check {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background: #22262e;
  color: var(--text);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.check:hover {
  border-color: var(--green);
  color: var(--green);
}
.check.on {
  border-color: var(--green);
  color: var(--green);
  background: rgba(63, 185, 80, 0.15);
}
.banner {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(210, 153, 34, 0.08);
  color: var(--yellow);
  padding: 7px 14px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.editor {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.binary-note {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--faint);
  font-size: 13px;
}
</style>
