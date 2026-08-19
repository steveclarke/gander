<script setup lang="ts">
import type { ChangedFile } from "@gander/shared";
import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import type { Store } from "../store.js";
import FileTree from "./FileTree.vue";

defineProps<{
  store: Store;
  mode: "explorer" | "changes";
  files: ChangedFile[];
  iconTheme: FileIconThemeId;
  typography: EffectiveTreeTypography;
}>();
defineEmits<{ scroll: [] }>();
</script>

<template>
  <aside class="local-sidebar" :aria-label="mode === 'explorer' ? 'Explorer' : 'Current Diff'">
    <header>
      <h1>{{ mode === "explorer" ? "Explorer" : "Current Diff" }}</h1>
      <span>{{ mode === "explorer" ? files.length : `${files.length} changed` }}</span>
    </header>
    <FileTree
      :store="store"
      :files="files"
      :show-status="mode === 'changes'"
      :icon-theme="iconTheme"
      :typography="typography"
      @scroll.passive="$emit('scroll')"
    />
  </aside>
</template>

<style scoped>
.local-sidebar { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--panel-background); }
header { height: 35px; flex: none; display: flex; align-items: center; gap: 8px; padding-inline: 12px; border-bottom: 1px solid var(--workbench-border); }
h1 { margin: 0; color: var(--muted-foreground); font-size: 10px; font-weight: 700; letter-spacing: .55px; text-transform: uppercase; }
header span { margin-left: auto; color: var(--faint-foreground); font: 10px var(--mono); }
.local-sidebar :deep(.tree.root) { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
</style>
