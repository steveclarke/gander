<script setup lang="ts">
import * as monaco from "monaco-editor";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { languageForPath } from "../languages.js";
import { basename, directoryPrefix } from "../paths.js";
import { codeEditorOptions, diffEditorOptions } from "../editor-options.js";
import { useMonacoSurface } from "../composables/use-monaco-surface.js";
import type { Store } from "../store.js";
import type { EditorSettings } from "../../../settings.js";
import { currentLine, pendingReveal } from "../selection.js";
import type { NoteTarget } from "../selection.js";
import { Check, FileClock, FileDiff, FileText, TriangleAlert } from "@lucide/vue";
import ImageDiff from "./ImageDiff.vue";
import type { ImagePreview } from "../../../api.js";
import type { PrFile } from "@gander/shared";

const props = defineProps<{ store: Store; editorSettings: EditorSettings }>();
const emit = defineEmits<{ addNote: [target: NoteTarget] }>();

const host = ref<HTMLElement | null>(null);
const view = ref<"diff" | "full" | "since">("diff");

// The file as it stood when the reviewer last checked it. Fetched lazily — it costs a
// round trip to the service and only the delta tab needs it.
const snapshot = ref<string | null>(null);
const snapshotFor = ref<string | null>(null);
const imagePreview = shallowRef<ImagePreview | null>(null);
const imageLoading = shallowRef(false);
const imageError = shallowRef<string | null>(null);
let imageRequest = 0;

// Only offered once the file has actually moved since it was reviewed. Before that
// the tab would render an empty diff and mean nothing.
const canShowDelta = computed(() => currentReviewFile.value?.changedSince === true);
let editor: monaco.editor.IStandaloneDiffEditor | monaco.editor.IStandaloneCodeEditor | null = null;
let models: monaco.editor.ITextModel[] = [];
let lineAction: HTMLButtonElement | null = null;
let lineActionLine: number | null = null;
// The keymap reaches the two things only this component can do: the tab set, and Monaco's
// own change-to-change navigation. Exposed rather than lifted, because both belong to the
// editor instance this component owns.
defineExpose({
  showDelta(): void {
    if (canShowDelta.value) view.value = view.value === "since" ? "diff" : "since";
  },
  goToChange(target: "next" | "previous"): void {
    if (editor !== null && "goToDiff" in editor) editor.goToDiff(target);
  },
});

const current = computed(
  () => props.store.files().find((f) => f.path === props.store.selectedPath) ?? null,
);
const currentReviewFile = computed(() => {
  const file = current.value;
  return file && "checked" in file ? file as PrFile : null;
});

const dirName = computed(() => current.value === null ? "" : directoryPrefix(current.value.path));
const baseName = computed(() => current.value === null ? "" : basename(current.value.path));
// The branch the pull request targets — "master" as often as "main".
const baseRef = computed(() => props.store.localView?.defaultBranch ?? props.store.view?.pr.baseRef ?? "the base branch");
const headLabel = computed(() => props.store.localView ? "Working tree" : "Head");

// git.ts hashes a binary blob's raw bytes but withholds its content, so `content === null`
// paired with a real hash (as opposed to a null hash, which means "absent at this revision")
// is how a binary file is told apart from a file that simply doesn't exist at that side of
// the diff. See git.ts's ShowFileResult doc comment for the full reasoning.
const baseBinary = computed(() => current.value !== null && current.value.baseContent === null && current.value.baseHash !== null);
const headBinary = computed(() => current.value !== null && current.value.headContent === null && current.value.headHash !== null);
const isBinary = computed(() => baseBinary.value || headBinary.value);
const imageKey = computed(() => {
  const file = current.value;
  return file && isBinary.value ? `${file.path}#${file.baseHash ?? ""}#${file.headHash ?? ""}` : null;
});

/** The editor holding the head revision: the diff editor's right-hand side, or the full file. */
function headEditor(): monaco.editor.ICodeEditor | null {
  if (!editor) return null;
  return "getModifiedEditor" in editor ? editor.getModifiedEditor() : editor;
}

function trackCursor(): void {
  const ed = headEditor();
  if (!ed) return;
  currentLine.value = ed.getPosition()?.lineNumber ?? null;
  if (!props.store.isLocal()) installLineAction(ed);
  ed.onDidChangeCursorPosition((e) => {
    currentLine.value = e.position.lineNumber;
    showLineAction(ed, e.position.lineNumber);
  });
}

function showLineAction(ed: monaco.editor.ICodeEditor, line: number): void {
  if (!lineAction) return;
  const position = ed.getScrolledVisiblePosition({ lineNumber: line, column: 1 });
  if (!position) {
    lineAction.hidden = true;
    return;
  }
  lineActionLine = line;
  lineAction.hidden = false;
  lineAction.style.top = `${position.top + Math.max(0, (position.height - 18) / 2)}px`;
  lineAction.style.left = `${ed.getLayoutInfo().glyphMarginLeft + 2}px`;
  lineAction.setAttribute("aria-label", `Add note on line ${line} (N)`);
  lineAction.title = `Add note on line ${line} (N)`;
}

function installLineAction(ed: monaco.editor.ICodeEditor): void {
  const dom = ed.getDomNode();
  if (!dom) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gander-line-note";
  button.textContent = "+";
  button.addEventListener("click", () => {
    const path = current.value?.path;
    if (path && lineActionLine !== null) emit("addNote", { path, line: lineActionLine });
  });
  dom.append(button);
  lineAction = button;
  const initialLine = ed.getPosition()?.lineNumber ?? 1;
  showLineAction(ed, initialLine);
  ed.onMouseMove((event) => {
    if (event.target.position) showLineAction(ed, event.target.position.lineNumber);
  });
  ed.onDidScrollChange(() => {
    if (lineActionLine !== null) showLineAction(ed, lineActionLine);
  });
  ed.onDidLayoutChange(() => {
    if (lineActionLine !== null) showLineAction(ed, lineActionLine);
  });
}

function dispose(): void {
  editor?.dispose();
  editor = null;
  lineAction = null;
  lineActionLine = null;
  // A line number from a file that is no longer on screen would stamp the next
  // note with a line the reader never looked at.
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
  if (view.value === "full") {
    const model = monaco.editor.createModel(file.headContent ?? "", lang);
    models = [model];
    editor = monaco.editor.create(host.value, { model, ...codeEditorOptions(props.editorSettings) });
  } else {
    // The delta tab shows what has landed since the reviewer last signed this file off:
    // their stored snapshot on the left rather than the base revision, current head on the right.
    const original = monaco.editor.createModel((view.value === "since" ? snapshot.value : file.baseContent) ?? "", lang);
    const modified = monaco.editor.createModel(file.headContent ?? "", lang);
    models = [original, modified];
    const diff = monaco.editor.createDiffEditor(host.value, diffEditorOptions(props.editorSettings));
    diff.setModel({ original, modified });
    editor = diff;
  }
  trackCursor();
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
  // The delta tab renders the snapshot, which arrives a round trip after the tab is
  // clicked. Holding the key back until it is in hand avoids building the diff against
  // an empty original first, which reads as the whole file having been added.
  if (view.value === "since" && snapshotFor.value !== file.path) return null;
  return `${file.path}#${file.baseHash ?? ""}#${file.headHash ?? ""}#${view.value}#${snapshotFor.value ?? ""}`;
});

// Fetch the snapshot when the delta tab is opened, once per file.
watch([() => current.value?.path, view], async ([path]) => {
  if (view.value !== "since" || !path) return;
  if (snapshotFor.value === path) return;
  if (isBinary.value) {
    snapshot.value = null;
    snapshotFor.value = path;
    return;
  }
  snapshot.value = await props.store.reviewedSnapshot(path);
  snapshotFor.value = path;
}, { immediate: true });

// A file that has not moved since review has nothing to show here; fall back rather
// than leave the reader on an empty tab after switching files.
watch(canShowDelta, (can) => { if (!can && view.value === "since") view.value = "diff"; });

watch(imageKey, async (key) => {
  const request = ++imageRequest;
  imagePreview.value = null;
  imageError.value = null;
  imageLoading.value = key !== null;
  if (key === null || current.value === null) return;
  try {
    const preview = await props.store.imagePreview(current.value.path);
    if (request === imageRequest) imagePreview.value = preview;
  } catch (err) {
    if (request === imageRequest) imageError.value = (err as Error).message;
  } finally {
    if (request === imageRequest) imageLoading.value = false;
  }
}, { immediate: true });

useMonacoSurface({ settings: () => props.editorSettings, editor: () => editor, dispose });
onMounted(render);
// flush: "post" — the binary/text split below is a v-if/v-else, so the `host` element is
// created or destroyed by that same content change. The default pre-flush timing would run
// render() before Vue patches the DOM, handing it a stale or absent host element.
/** Jump to a line the reader picked in the notes drawer, unfolding it if it is hidden. */
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
          v-if="canShowDelta"
          role="tab"
          :aria-selected="view === 'since'"
          :class="{ active: view === 'since' }"
          aria-label="Changes since your review"
          title="Changes since your review"
          @click="view = 'since'"
        >
          <FileClock :size="15" />
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
        v-if="currentReviewFile"
        class="check"
        :class="{ on: currentReviewFile.checked }"
        @click="store.setChecked(current.path, !currentReviewFile.checked)"
      >
        <Check v-if="currentReviewFile.checked" :size="14" :stroke-width="3" />
        <span>{{ currentReviewFile.checked ? "Reviewed" : "Mark reviewed" }}</span>
      </button>
    </header>
    <div v-if="currentReviewFile?.changedSince" class="banner">
      <TriangleAlert :size="14" />
      <span>Changed since your review — un-checked automatically. Re-review and mark again.</span>
    </div>
    <div v-if="isBinary && imageLoading" class="binary-note">Loading image preview…</div>
    <div v-else-if="isBinary && imageError" class="binary-note" role="alert">Image preview failed: {{ imageError }}</div>
    <ImageDiff
      v-else-if="isBinary && imagePreview"
      :preview="imagePreview"
      :filename="baseName"
      :base-label="baseRef"
      :head-label="headLabel"
      :mode="view"
    />
    <div v-else-if="isBinary" class="binary-note">Binary file — diff cannot be displayed.</div>
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
  border-bottom: 1px solid var(--workbench-border);
  background: var(--panel-background);
  flex: none;
}
.path {
  font: 12.5px var(--mono);
  color: var(--workbench-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.path .dir {
  color: var(--faint-foreground);
}
.tabs {
  margin-left: auto;
  display: flex;
  gap: 2px;
  background: var(--input-background);
  border-radius: var(--radius-md);
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
  color: var(--muted-foreground);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.tabs button.active {
  background: var(--elevated-background);
  color: var(--workbench-foreground);
}
.check {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--workbench-border);
  background: var(--elevated-background);
  color: var(--workbench-foreground);
  border-radius: var(--radius-md);
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.check:hover {
  border-color: var(--success);
  color: var(--success);
}
.check.on {
  border-color: var(--success);
  color: var(--success);
  background: var(--success-background);
}
.banner {
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--warning-background);
  color: var(--warning);
  padding: 7px 14px;
  font-size: 12px;
  border-bottom: 1px solid var(--workbench-border);
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
  color: var(--faint-foreground);
  font-size: 13px;
}
:deep(.gander-line-note) {
  position: absolute;
  z-index: 10;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1px;
  border: 1px solid var(--workbench-border);
  border-radius: var(--radius-sm);
  background: var(--elevated-background);
  color: var(--workbench-foreground);
  font: 700 16px/1 var(--mono);
  cursor: pointer;
}
:deep(.gander-line-note:hover) {
  border-color: var(--accent);
  color: var(--accent);
}
:deep(.gander-line-note:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
