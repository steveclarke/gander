<script setup lang="ts">
import { computed, watch } from "vue";
import type { Store } from "../store.js";
import { buildTree, dirState, filesUnder, type TreeNode } from "../tree.js";
import { collapsedDirs, cursor, toggleCollapsed } from "../tree-nav.js";
import { iconThemeShowsExplorerArrows } from "../icon-theme.js";
import { useTreeIcons, treeTypographyStyle } from "../composables/use-tree-icons.js";
import { basename } from "../paths.js";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import { Check, ChevronDown, ChevronRight, MessageSquare, Minus } from "@lucide/vue";
import FileIcon from "./FileIcon.vue";
import type { ChangedFile, PrFile } from "@gander/shared";
import type { JumpTarget } from "../tree-jump.js";

const props = withDefaults(defineProps<{
  store: Store;
  iconTheme: FileIconThemeId;
  typography?: EffectiveTreeTypography;
  nodes?: TreeNode[];
  depth?: number;
  files?: ChangedFile[];
  showStatus?: boolean;
  jumpTargets?: ReadonlyMap<string, JumpTarget>;
}>(), { showStatus: true });

const depth = computed(() => props.depth ?? 0);
const nodes = computed(() => props.nodes ?? buildTree(props.files ?? props.store.files()));
const showStatus = computed(() => props.showStatus);
const local = computed(() => props.store.isLocal());
const rootTypographyStyle = computed(() => treeTypographyStyle(depth.value, props.typography));
const { fileIcon, folderIcon } = useTreeIcons(() => props.iconTheme);

// dirState flat-maps and sorts the whole subtree under a directory. The template calls it
// twice per dir row (class binding + aria-checked) — memoize it once per node per render
// instead of walking the subtree on every call.
// FileTree renders itself recursively, so every level would otherwise re-scan the whole
// note list per row.
// Resolved notes are finished business, so they stop marking the file — otherwise a
// heavily reviewed file wears the marker forever.
const noteCounts = computed(() => {
  const map = new Map<string, number>();
  for (const q of props.store.view?.notes ?? []) {
    if (q.path !== null && q.state !== "resolved") map.set(q.path, (map.get(q.path) ?? 0) + 1);
  }
  return map;
});

function noteTitle(path: string): string {
  const count = noteCounts.value.get(path) ?? 0;
  return `${count} unresolved note${count === 1 ? "" : "s"} on this file`;
}

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
watch(prIdentity, () => { if (depth.value === 0) collapsedDirs.clear(); });

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

function nameParts(path: string, name: string): { text: string; matched: boolean }[] {
  const matched = new Set(props.jumpTargets?.get(path)?.matchIndices ?? []);
  return [...name].map((text, index) => ({ text, matched: matched.has(index) }));
}

function jumpShortcut(path: string): string | undefined {
  const label = props.jumpTargets?.get(path)?.label;
  return label ?? undefined;
}
</script>

<template>
  <div class="tree" :class="{ root: depth === 0 }" :style="rootTypographyStyle">
    <template v-for="node in nodes" :key="node.type === 'dir' ? node.path : node.file.path">
      <div
        v-if="node.type === 'dir'"
        class="tnode isdir"
        :class="{ cur: node.path === cursor }"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        :aria-keyshortcuts="jumpShortcut(node.path)"
        role="button"
        tabindex="0"
        @click="cursor = node.path; toggleCollapsed(node.path)"
        @keydown.enter.space.prevent="toggleCollapsed(node.path)"
      >
        <component
          :is="collapsedDirs.has(node.path) ? ChevronRight : ChevronDown"
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
        <FileIcon :icon="folderIcon(node.name, !collapsedDirs.has(node.path))" />
        <span class="fname">
          <template v-for="(part, index) in nameParts(node.path, node.name)" :key="index">
            <mark v-if="part.matched" class="jump-match">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
        <span v-if="jumpTargets?.get(node.path)?.label" class="jump-label" aria-hidden="true">{{ jumpTargets.get(node.path)?.label }}</span>
      </div>
      <FileTree
        v-if="node.type === 'dir' && !collapsedDirs.has(node.path)"
        :store="store"
        :icon-theme="iconTheme"
        :nodes="node.children"
        :depth="depth + 1"
        :show-status="showStatus"
        :jump-targets="jumpTargets"
      />
      <div
        v-if="node.type === 'file'"
        class="tnode"
        :class="{ sel: node.file.path === store.selectedPath, cur: node.file.path === cursor, checked: reviewFile(node)?.checked }"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        :aria-keyshortcuts="jumpShortcut(node.file.path)"
        role="button"
        tabindex="0"
        @click="cursor = node.file.path; store.select(node.file.path)"
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
        <FileIcon :icon="fileIcon(node.file.path)" />
        <span class="fname">
          <template v-for="(part, index) in nameParts(node.file.path, basename(node.file.path))" :key="index">
            <mark v-if="part.matched" class="jump-match">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
        <span v-if="jumpTargets?.get(node.file.path)?.label" class="jump-label" aria-hidden="true">{{ jumpTargets.get(node.file.path)?.label }}</span>
        <span v-if="noteCounts.get(node.file.path)" class="note-mark" :title="noteTitle(node.file.path)">
          <MessageSquare :size="12" />
          <!-- The icon alone already says "one note"; the number earns its space only
               once there is more than one. -->
          <span v-if="noteCounts.get(node.file.path)! > 1" class="note-count">{{ noteCounts.get(node.file.path) }}</span>
        </span>
        <span v-if="reviewFile(node)?.changedSince" class="delta-mark" title="Changed since your review" />
        <span v-if="showStatus" class="st" :class="node.file.status">{{ node.file.status }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped src="../styles/tree.css"></style>

<style scoped>
.tree.root { padding: 8px 0; }
.tnode .st { margin-left: auto; font: 11px var(--mono); flex: none; }
.st.M { color: var(--warning); }
.st.A { color: var(--success); }
.st.D { color: var(--danger); }
.st.R { color: var(--info); }
.cb { width: 15px; height: 15px; flex: none; border: 1.5px solid var(--faint-foreground); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 11px; color: transparent; }
.cb.on { border-color: var(--success); color: var(--success); }
.cb.part { border-color: var(--success); color: var(--success); }
.tnode.checked .fname { color: var(--faint-foreground); }

.jump-match { padding: 0; border-radius: 1px; background: var(--accent); color: var(--accent-foreground); font-weight: 750; }
.jump-label { width: 15px; height: 15px; flex: none; display: inline-grid; place-items: center; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-foreground); font: 800 10px/1 var(--mono); }

.note-mark { display: inline-flex; align-items: center; gap: 2px; color: var(--accent); flex: none; }
.note-count { font-size: 10px; line-height: 1; font-variant-numeric: tabular-nums; }
.delta-mark { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); flex: none; }
</style>
