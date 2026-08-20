<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { LocalFileEntry } from "@gander/shared";
import { ChevronDown, ChevronRight, LoaderCircle } from "@lucide/vue";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import type { Store } from "../store.js";
import { iconThemeShowsExplorerArrows } from "../icon-theme.js";
import { useTreeIcons, treeTypographyStyle } from "../composables/use-tree-icons.js";
import { basename, parentDirectory } from "../paths.js";
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
const rootTypographyStyle = computed(() => treeTypographyStyle(props.depth, props.typography));
const { fileIcon, folderIcon } = useTreeIcons(() => props.iconTheme);
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
        <LoaderCircle v-if="loading.has(entry.path)" class="hierarchy-slot loading spin" :size="13" aria-hidden="true" />
        <component
          :is="expanded.has(entry.path) ? ChevronDown : ChevronRight"
          v-else-if="iconThemeShowsExplorerArrows(iconTheme)"
          class="hierarchy-slot chev"
          :size="14"
          aria-hidden="true"
        />
        <span v-else class="hierarchy-slot" aria-hidden="true" />
        <span class="review-slot" aria-hidden="true" />
        <FileIcon :icon="folderIcon(basename(entry.path), expanded.has(entry.path))" />
        <span class="fname">{{ basename(entry.path) }}</span>
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
        <FileIcon :icon="fileIcon(entry.path)" />
        <span class="fname">{{ basename(entry.path) }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped src="../styles/tree.css"></style>

<style scoped>
.local-tree.root { height: 100%; overflow: auto; padding: 8px 0; box-sizing: border-box; }
.tnode { width: 100%; border: 0; background: none; color: var(--workbench-foreground); text-align: left; }
.loading { color: var(--faint-foreground); }
</style>
