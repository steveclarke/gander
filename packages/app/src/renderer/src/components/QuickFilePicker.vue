<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useTemplateRef, watch } from "vue";
import { Search } from "@lucide/vue";
import type { PrFile } from "@gander/shared";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import { bindingLabel } from "../keymap.js";
import { quickFileMatches } from "../quick-file.js";
import { useTreeIcons } from "../composables/use-tree-icons.js";
import FileIcon from "./FileIcon.vue";

const props = defineProps<{
  files: PrFile[];
  selectedPath: string | null;
  iconTheme: FileIconThemeId;
}>();
const emit = defineEmits<{ close: []; select: [path: string] }>();

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const input = useTemplateRef<HTMLInputElement>("input");
const query = shallowRef("");
const initiallySelected = props.files.findIndex((file) => file.path === props.selectedPath);
const activeIndex = shallowRef(Math.max(0, initiallySelected));
const matches = computed(() => quickFileMatches(props.files.map((file) => file.path), query.value));
const activeId = computed(() => matches.value[activeIndex.value] === undefined
  ? undefined
  : `quick-file-option-${activeIndex.value}`);
const filesByPath = computed(() => new Map(props.files.map((file) => [file.path, file])));
const { fileIcon } = useTreeIcons(() => props.iconTheme);
const shortcutLabel = bindingLabel("quick-file");
let returnFocus: HTMLElement | null = null;

onMounted(async () => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.showModal();
  await nextTick();
  input.value?.focus();
  input.value?.select();
});

watch(query, () => { activeIndex.value = 0; });
watch(matches, (next) => {
  if (activeIndex.value >= next.length) activeIndex.value = Math.max(0, next.length - 1);
});
watch(activeIndex, async (index) => {
  await nextTick();
  dialog.value?.querySelector(`#quick-file-option-${index}`)?.scrollIntoView?.({ block: "nearest" });
});

function move(delta: 1 | -1): void {
  if (matches.value.length === 0) return;
  activeIndex.value = (activeIndex.value + delta + matches.value.length) % matches.value.length;
}

function choose(path = matches.value[activeIndex.value]?.path): void {
  if (path !== undefined) finish("select", path);
}

async function finish(action: "close" | "select", path?: string): Promise<void> {
  dialog.value?.close();
  if (action === "select" && path !== undefined) emit("select", path);
  else emit("close");
  await nextTick();
  if (returnFocus?.isConnected) returnFocus.focus();
}

function closeFromBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) void finish("close");
}

function pathParts(path: string, matchIndices: number[]): Array<{ text: string; matched: boolean }> {
  const matched = new Set(matchIndices);
  return [...path].map((text, index) => ({ text, matched: matched.has(index) }));
}
</script>

<template>
  <dialog
    ref="dialog"
    class="quick-file"
    aria-label="Quick file jump"
    @cancel.prevent="finish('close')"
    @click="closeFromBackdrop"
  >
    <div class="picker">
      <label class="search-field">
        <Search :size="16" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          autofocus
          type="text"
          role="combobox"
          aria-label="Search files in this pull request"
          aria-autocomplete="list"
          aria-controls="quick-file-results"
          :aria-activedescendant="activeId"
          aria-expanded="true"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search files by path"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="choose()"
          @keydown.escape.prevent="finish('close')"
        >
        <kbd>{{ shortcutLabel }}</kbd>
      </label>

      <div id="quick-file-results" class="results" role="listbox" aria-label="Matching files">
        <button
          v-for="(match, index) in matches"
          :id="`quick-file-option-${index}`"
          :key="match.path"
          type="button"
          class="result"
          :class="{ active: index === activeIndex }"
          role="option"
          :aria-selected="index === activeIndex"
          @mousemove="activeIndex = index"
          @click="choose(match.path)"
        >
          <FileIcon :icon="fileIcon(match.path)" />
          <span class="path">
            <template v-for="(part, partIndex) in pathParts(match.path, match.matchIndices)" :key="partIndex">
              <mark v-if="part.matched" class="match">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span class="status" :class="filesByPath.get(match.path)?.status">
            {{ filesByPath.get(match.path)?.status }}
          </span>
        </button>
        <p v-if="matches.length === 0" class="empty">No matching files</p>
      </div>

      <footer class="hints" aria-hidden="true">
        <span><kbd>↑↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Open</span>
        <span><kbd>Esc</kbd> Close</span>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.quick-file {
  width: min(640px, calc(100vw - 48px)); max-height: min(520px, calc(100vh - 80px));
  margin: 58px auto auto; padding: 0; overflow: hidden;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-lg);
  background: var(--panel-background); color: var(--workbench-foreground);
  box-shadow: 0 18px 48px var(--workbench-shadow);
}
.quick-file::backdrop { background: var(--overlay-background); }
.picker { display: flex; max-height: min(520px, calc(100vh - 80px)); flex-direction: column; }
.search-field { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--workbench-border); color: var(--faint-foreground); }
.search-field:focus-within { color: var(--accent); box-shadow: inset 0 -1px 0 var(--accent); }
.search-field input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--workbench-foreground); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; caret-color: var(--accent); }
.search-field input::placeholder { color: var(--faint-foreground); }
kbd { display: inline-flex; min-width: 24px; height: 20px; align-items: center; justify-content: center; padding: 0 5px; border: 1px solid var(--workbench-border); border-radius: var(--radius-sm); background: var(--input-background); color: var(--muted-foreground); font: 10px/1 var(--mono); }
.results { min-height: 42px; overflow-y: auto; padding: 6px; }
.result { display: grid; width: 100%; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 30px; padding: 4px 8px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--workbench-foreground); text-align: left; cursor: pointer; }
.result.active { background: var(--selection-background); }
.result:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.path { overflow: hidden; font: 12.5px/1.4 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.match { padding: 0; background: transparent; color: var(--accent); font-weight: 750; }
.status { color: var(--faint-foreground); font: 11px/1 var(--mono); }
.status.M { color: var(--warning); }
.status.A { color: var(--success); }
.status.D { color: var(--danger); }
.status.R { color: var(--info); }
.empty { padding: 16px 10px; color: var(--faint-foreground); text-align: center; }
.hints { display: flex; justify-content: flex-end; gap: 14px; padding: 6px 10px; border-top: 1px solid var(--workbench-border); color: var(--faint-foreground); font-size: 10.5px; }
.hints span { display: inline-flex; align-items: center; gap: 5px; }
</style>
