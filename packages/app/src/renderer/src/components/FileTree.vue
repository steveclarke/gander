<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { Store } from "../store.js";
import { buildTree, dirState, filesUnder, type TreeNode } from "../tree.js";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-vue-next";

const props = defineProps<{ store: Store; nodes?: TreeNode[]; depth?: number }>();

const collapsed = reactive(new Set<string>());

const depth = computed(() => props.depth ?? 0);
const nodes = computed(() => props.nodes ?? buildTree(props.store.view?.files ?? []));

// dirState flat-maps and sorts the whole subtree under a directory. The template calls it
// twice per dir row (class binding + aria-checked) — memoize it once per node per render
// instead of walking the subtree on every call.
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
const prIdentity = computed(() => `${props.store.currentRepoId ?? ""}#${props.store.view?.pr.number ?? ""}`);
watch(prIdentity, () => collapsed.clear());

function toggleCollapsed(path: string) {
  if (collapsed.has(path)) collapsed.delete(path);
  else collapsed.add(path);
}

function checkDir(node: TreeNode & { type: "dir" }) {
  const files = filesUnder(node);
  const anyUnchecked = files.some((f) => !f.checked);
  props.store.setCheckedMany(files.map((f) => f.path), anyUnchecked);
}

function toggleFile(path: string, checked: boolean) {
  props.store.setChecked(path, !checked);
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}


</script>

<template>
  <div class="tree" :class="{ root: depth === 0 }">
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
        <component :is="collapsed.has(node.path) ? ChevronRight : ChevronDown" class="chev" :size="14" />
        <span
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
        <span class="fname">{{ node.name }}</span>
      </div>
      <FileTree
        v-if="node.type === 'dir' && !collapsed.has(node.path)"
        :store="store"
        :nodes="node.children"
        :depth="depth + 1"
      />
      <div
        v-if="node.type === 'file'"
        class="tnode"
        :class="{ sel: node.file.path === store.selectedPath, checked: node.file.checked }"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        role="button"
        tabindex="0"
        @click="store.select(node.file.path)"
        @keydown.enter.space.prevent="store.select(node.file.path)"
      >
        <span
          class="cb"
          :class="{ on: node.file.checked }"
          role="checkbox"
          :aria-checked="node.file.checked"
          tabindex="0"
          @click.stop="toggleFile(node.file.path, node.file.checked)"
          @keydown.enter.space.stop.prevent="toggleFile(node.file.path, node.file.checked)"
        ><Check :size="12" :stroke-width="3" /></span>
        <span class="fname">{{ fileName(node.file.path) }}</span>
        <span v-if="node.file.changedSince" class="delta-mark" title="Changed since your review" />
        <span class="st" :class="node.file.status">{{ node.file.status }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree.root { padding: 8px 0; }
.tnode { display: flex; align-items: center; gap: 6px; padding: 3px 12px 3px 0; cursor: pointer; white-space: nowrap; }
.tnode:hover { background: #232833; }
.tnode.sel { background: rgba(77, 159, 236, 0.14); box-shadow: inset 2px 0 0 var(--accent); }
.tnode .chev { flex: none; color: var(--faint); }
.tnode .fname { font: 12.5px var(--mono); overflow: hidden; text-overflow: ellipsis; }
.tnode.isdir .fname { font: 600 12px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--dim); }
.tnode .st { margin-left: auto; font: 11px var(--mono); flex: none; }
.st.M { color: var(--yellow); }
.st.A { color: var(--green); }
.st.D { color: var(--red); }
.st.R { color: var(--purple); }
.cb { width: 15px; height: 15px; flex: none; border: 1.5px solid var(--faint); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: transparent; }
.cb.on { border-color: var(--green); color: var(--green); }
.cb.part { border-color: var(--green); color: var(--green); }
.tnode.checked .fname { color: var(--faint); }
.delta-mark { width: 7px; height: 7px; border-radius: 50%; background: var(--yellow); flex: none; }
</style>
