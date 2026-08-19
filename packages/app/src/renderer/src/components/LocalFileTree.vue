<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { LocalFileEntry } from "@gander/shared";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-vue-next";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import type { Store } from "../store.js";
import { fileIconFor, folderIconFor, iconThemeShowsExplorerArrows } from "../icon-theme.js";
import { languageForPath } from "../languages.js";
import FileIcon from "./FileIcon.vue";

const props = withDefaults(defineProps<{
  store: Store;
  entries: LocalFileEntry[];
  iconTheme: FileIconThemeId;
  typography?: EffectiveTreeTypography;
  parent?: string;
  depth?: number;
}>(), { parent: "", depth: 0 });

const emit = defineEmits<{ scroll: [] }>();
const expanded = reactive(new Set<string>());
const loading = reactive(new Set<string>());
const children = computed(() => props.entries
  .filter((entry) => parentDirectory(entry.path) === props.parent)
  .sort((left, right) => left.kind === right.kind
    ? left.path.localeCompare(right.path)
    : left.kind === "directory" ? -1 : 1));
const rootTypographyStyle = computed(() => props.depth === 0 && props.typography
  ? { fontFamily: props.typography.fontFamily, fontSize: `${props.typography.fontSize}px` }
  : undefined);
const worktreePath = computed(() => props.store.localView?.worktree.path ?? "");

watch(worktreePath, () => {
  expanded.clear();
  loading.clear();
});

async function toggleDirectory(path: string): Promise<void> {
  if (loading.has(path)) return;
  if (expanded.has(path)) {
    expanded.delete(path);
    return;
  }
  loading.add(path);
  try {
    await props.store.loadLocalDirectory(path);
    if (props.store.loadedLocalDirectories.includes(path)) expanded.add(path);
  } finally {
    loading.delete(path);
  }
}

function parentDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function name(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function fileIcon(path: string) {
  const languageId = languageForPath(path);
  return fileIconFor(props.iconTheme, {
    path,
    languageId: languageId === "plaintext" ? undefined : languageId,
  });
}

function folderIcon(entry: LocalFileEntry) {
  return folderIconFor(props.iconTheme, { name: name(entry.path), expanded: expanded.has(entry.path) });
}
</script>

<template>
  <div class="local-tree" :class="{ root: depth === 0 }" :style="rootTypographyStyle" @scroll.passive="emit('scroll')">
    <template v-for="entry in children" :key="entry.path">
      <button
        v-if="entry.kind === 'directory'"
        class="tnode isdir"
        type="button"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        :aria-expanded="expanded.has(entry.path)"
        :aria-busy="loading.has(entry.path) || undefined"
        @click="toggleDirectory(entry.path)"
      >
        <LoaderCircle v-if="loading.has(entry.path)" class="hierarchy-slot loading" :size="13" aria-hidden="true" />
        <component
          :is="expanded.has(entry.path) ? ChevronDown : ChevronRight"
          v-else-if="iconThemeShowsExplorerArrows(iconTheme)"
          class="hierarchy-slot chev"
          :size="14"
          aria-hidden="true"
        />
        <span v-else class="hierarchy-slot" aria-hidden="true" />
        <span class="review-slot" aria-hidden="true" />
        <FileIcon :src="folderIcon(entry).src" :data-icon-id="folderIcon(entry).id" />
        <span class="fname">{{ name(entry.path) }}</span>
      </button>
      <LocalFileTree
        v-if="entry.kind === 'directory' && expanded.has(entry.path)"
        :store="store"
        :entries="entries"
        :icon-theme="iconTheme"
        :parent="entry.path"
        :depth="depth + 1"
        @scroll="emit('scroll')"
      />
      <button
        v-if="entry.kind === 'file'"
        class="tnode"
        :class="{ sel: entry.path === store.selectedPath }"
        type="button"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        @click="store.select(entry.path)"
      >
        <span class="hierarchy-slot" aria-hidden="true" />
        <span class="review-slot" aria-hidden="true" />
        <FileIcon :src="fileIcon(entry.path).src" :data-icon-id="fileIcon(entry.path).id" />
        <span class="fname">{{ name(entry.path) }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.local-tree.root { height: 100%; overflow: auto; padding: 8px 0; box-sizing: border-box; }
.tnode { width: 100%; display: flex; align-items: center; gap: 6px; height: 22px; padding: 3px 12px 3px 0; border: 0; background: none; box-sizing: border-box; color: var(--workbench-foreground); font: inherit; text-align: left; cursor: pointer; white-space: nowrap; }
.tnode:hover { background: var(--hover-background); }
.tnode:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.tnode.sel { background: var(--selection-background); box-shadow: inset 2px 0 0 var(--accent); }
.tnode .hierarchy-slot { width: 14px; flex: none; }
.tnode .chev { color: var(--faint-foreground); }
.tnode .fname { overflow: hidden; text-overflow: ellipsis; }
.tnode.isdir .fname { color: var(--muted-foreground); }
.review-slot { width: 15px; flex: none; }
.loading { color: var(--faint-foreground); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .loading { animation: none; } }
</style>
