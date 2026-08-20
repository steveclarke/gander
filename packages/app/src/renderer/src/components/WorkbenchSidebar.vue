<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from "vue";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import type { Store } from "../store.js";
import type { JumpTarget } from "../tree-jump.js";
import { treeWidth } from "../layout.js";
import LocalSidebar from "./LocalSidebar.vue";
import PullRequestSidebar from "./PullRequestSidebar.vue";
import Splitter from "./Splitter.vue";

/** The tree beside the work surface, and the handle that sizes it. */
defineProps<{
  store: Store;
  mode: "explorer" | "changes" | "pulls";
  iconTheme: FileIconThemeId;
  typography: EffectiveTreeTypography;
  jumpTargets: ReadonlyMap<string, JumpTarget>;
}>();
defineEmits<{ selectPr: [prNumber: number] }>();

// The scrollbar is invisible until the tree is in use, so that a still sidebar is just
// filenames. Scrolling counts as use for a moment after it stops.
const scrolling = shallowRef(false);
let settle: ReturnType<typeof setTimeout> | undefined;

function onScroll(): void {
  scrolling.value = true;
  clearTimeout(settle);
  settle = setTimeout(() => { scrolling.value = false; }, 500);
}

onBeforeUnmount(() => { clearTimeout(settle); });
</script>

<template>
  <div class="view-sidebar" :class="{ scrolling }" :style="{ width: `${treeWidth}px` }">
    <LocalSidebar
      v-if="mode === 'explorer' || mode === 'changes'"
      :store="store"
      :mode="mode"
      :icon-theme="iconTheme"
      :typography="typography"
      @scroll="onScroll"
    />
    <PullRequestSidebar
      v-else
      :store="store"
      :icon-theme="iconTheme"
      :typography="typography"
      :jump-targets="jumpTargets"
      @select-pr="$emit('selectPr', $event)"
      @scroll="onScroll"
    />
  </div>
  <Splitter v-model="treeWidth" orientation="vertical" :min="190" :max="520" />
</template>

<style scoped>
.view-sidebar { --scrollbar-thumb: transparent; --scrollbar-track: transparent; flex: none; min-height: 0; border-right: 1px solid var(--workbench-border); scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track); scrollbar-width: thin; transition: scrollbar-color 120ms cubic-bezier(0.16, 1, 0.3, 1); }
.view-sidebar:hover, .view-sidebar:focus-within, .view-sidebar.scrolling { --scrollbar-thumb: color-mix(in srgb, var(--faint-foreground) 45%, transparent); }
@media (prefers-reduced-motion: reduce) { .view-sidebar { transition: none; } }
@media (prefers-contrast: more) { .view-sidebar:hover, .view-sidebar:focus-within, .view-sidebar.scrolling { --scrollbar-thumb: var(--workbench-foreground); } }
@media (forced-colors: active) { .view-sidebar { scrollbar-color: auto; } }
</style>
