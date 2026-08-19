<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { Store } from "../store.js";
import { buildTree, dirState, filesUnder, type TreeNode } from "../tree.js";
import {
  fileIconFor,
  folderIconFor,
  iconThemeShowsExplorerArrows,
} from "../icon-theme.js";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import { languageForPath } from "../languages.js";
import { Check, ChevronDown, ChevronRight, MessageSquare, Minus } from "lucide-vue-next";
import FileIcon from "./FileIcon.vue";
import type { ChangedFile, PrFile } from "@gander/shared";

const props = withDefaults(defineProps<{
  store: Store;
  iconTheme: FileIconThemeId;
  typography?: EffectiveTreeTypography;
  nodes?: TreeNode[];
  depth?: number;
  files?: ChangedFile[];
  showStatus?: boolean;
}>(), { showStatus: true });

const collapsed = reactive(new Set<string>());

const depth = computed(() => props.depth ?? 0);
const nodes = computed(() => props.nodes ?? buildTree(props.files ?? props.store.files()));
const showStatus = computed(() => props.showStatus);
const local = computed(() => props.store.isLocal());
const rootTypographyStyle = computed(() => depth.value === 0 && props.typography
  ? { fontFamily: props.typography.fontFamily, fontSize: `${props.typography.fontSize}px` }
  : undefined);

// dirState flat-maps and sorts the whole subtree under a directory. The template calls it
// twice per dir row (class binding + aria-checked) — memoize it once per node per render
// instead of walking the subtree on every call.
// FileTree renders itself recursively, so every level would otherwise re-scan the whole
// question list per row.
const questionCounts = computed(() => {
  const map = new Map<string, number>();
  for (const q of props.store.view?.questions ?? []) {
    if (q.path !== null) map.set(q.path, (map.get(q.path) ?? 0) + 1);
  }
  return map;
});

const dirStates = computed(() => {
  const map = new Map<string, "all" | "some" | "none">();
  for (const node of nodes.value) if (node.type === "dir") map.set(node.path, dirState(node));
  return map;
});
function dirStateFor(node: TreeNode & { type: "dir" }): "all" | "some" | "none" {
  return dirStates.value.get(node.path) ?? "none";
}

// Directory paths carry no PR identity, and `store.openPr` reassigns `view` in one step
// (never through a null in between), so switching PRs within the same repo never unmounts
// this component. Clear stale collapse state whenever the reviewed PR changes.
const prIdentity = computed(() => `${props.store.currentRepoId ?? ""}#${props.store.view?.pr.number ?? props.store.localView?.worktree.path ?? ""}`);
watch(prIdentity, () => collapsed.clear());

function toggleCollapsed(path: string) {
  if (collapsed.has(path)) collapsed.delete(path);
  else collapsed.add(path);
}

function checkDir(node: TreeNode & { type: "dir" }) {
  const files = filesUnder(node).filter((file): file is PrFile => "checked" in file);
  const anyUnchecked = files.some((f) => !f.checked);
  props.store.setCheckedMany(files.map((f) => f.path), anyUnchecked);
}

function reviewFile(file: TreeNode & { type: "file" }): PrFile | null {
  return "checked" in file.file ? file.file as PrFile : null;
}

function toggleFile(path: string, checked: boolean) {
  props.store.setChecked(path, !checked);
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function fileIcon(path: string) {
  const languageId = languageForPath(path);
  return fileIconFor(props.iconTheme, {
    path,
    languageId: languageId === "plaintext" ? undefined : languageId,
  });
}

function folderIcon(node: TreeNode & { type: "dir" }) {
  return folderIconFor(props.iconTheme, { name: node.name, expanded: !collapsed.has(node.path) });
}
</script>

<template>
  <div class="tree" :class="{ root: depth === 0 }" :style="rootTypographyStyle">
    <template v-for="node in nodes" :key="node.type === 'dir' ? node.path : node.file.path">
      <div
        v-if="node.type === 'dir'"
        class="tnode isdir"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        role="button"
        tabindex="0"
        @click="toggleCollapsed(node.path)"
        @keydown.enter.space.prevent="toggleCollapsed(node.path)"
      >
        <component
          :is="collapsed.has(node.path) ? ChevronRight : ChevronDown"
          v-if="iconThemeShowsExplorerArrows(iconTheme)"
          class="hierarchy-slot chev"
          :size="14"
        />
        <span v-else class="hierarchy-slot" aria-hidden="true" />
        <span
          v-if="!local"
          class="cb"
          :class="{ on: dirStateFor(node) === 'all', part: dirStateFor(node) === 'some' }"
          role="checkbox"
          :aria-checked="dirStateFor(node) === 'all'"
          tabindex="0"
          @click.stop="checkDir(node)"
          @keydown.enter.space.stop.prevent="checkDir(node)"
        >
          <Minus v-if="dirStateFor(node) === 'some'" :size="12" :stroke-width="3" />
          <Check v-else :size="12" :stroke-width="3" />
        </span>
        <span v-else class="review-slot" aria-hidden="true" />
        <FileIcon :src="folderIcon(node).src" :data-icon-id="folderIcon(node).id" />
        <span class="fname">{{ node.name }}</span>
      </div>
      <FileTree
        v-if="node.type === 'dir' && !collapsed.has(node.path)"
        :store="store"
        :icon-theme="iconTheme"
        :nodes="node.children"
        :depth="depth + 1"
        :show-status="showStatus"
      />
      <div
        v-if="node.type === 'file'"
        class="tnode"
        :class="{ sel: node.file.path === store.selectedPath, checked: reviewFile(node)?.checked }"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        role="button"
        tabindex="0"
        @click="store.select(node.file.path)"
        @keydown.enter.space.prevent="store.select(node.file.path)"
      >
        <span class="hierarchy-slot" aria-hidden="true" />
        <span
          v-if="reviewFile(node)"
          class="cb"
          :class="{ on: reviewFile(node)?.checked }"
          role="checkbox"
          :aria-checked="reviewFile(node)?.checked"
          tabindex="0"
          @click.stop="toggleFile(node.file.path, reviewFile(node)?.checked ?? false)"
          @keydown.enter.space.stop.prevent="toggleFile(node.file.path, reviewFile(node)?.checked ?? false)"
        ><Check :size="12" :stroke-width="3" /></span>
        <span v-else class="review-slot" aria-hidden="true" />
        <FileIcon :src="fileIcon(node.file.path).src" :data-icon-id="fileIcon(node.file.path).id" />
        <span class="fname">{{ fileName(node.file.path) }}</span>
        <MessageSquare
          v-if="questionCounts.get(node.file.path)"
          class="qmark"
          :size="12"
          :title="`${questionCounts.get(node.file.path)} question(s) on this file`"
        />
        <span v-if="reviewFile(node)?.changedSince" class="delta-mark" title="Changed since your review" />
        <span v-if="showStatus" class="st" :class="node.file.status">{{ node.file.status }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree.root { padding: 8px 0; }
.tnode { display: flex; align-items: center; gap: 6px; height: 22px; padding: 3px 12px 3px 0; box-sizing: border-box; cursor: pointer; white-space: nowrap; }
.tnode:hover { background: var(--hover-background); }
.tnode.sel { background: var(--selection-background); box-shadow: inset 2px 0 0 var(--accent); }
.tnode .hierarchy-slot { width: 14px; flex: none; }
.tnode .chev { flex: none; color: var(--faint-foreground); }
.tnode .fname { font: inherit; overflow: hidden; text-overflow: ellipsis; }
.tnode.isdir .fname { color: var(--muted-foreground); }
.tnode .st { margin-left: auto; font: 11px var(--mono); flex: none; }
.st.M { color: var(--warning); }
.st.A { color: var(--success); }
.st.D { color: var(--danger); }
.st.R { color: var(--info); }
.cb { width: 15px; height: 15px; flex: none; border: 1.5px solid var(--faint-foreground); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: transparent; }
.cb.on { border-color: var(--success); color: var(--success); }
.cb.part { border-color: var(--success); color: var(--success); }
.review-slot { width: 15px; flex: none; }
.tnode.checked .fname { color: var(--faint-foreground); }
.qmark { color: var(--accent); flex: none; }
.delta-mark { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); flex: none; }
</style>
