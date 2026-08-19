<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { ImagePreview } from "../../../api.js";
import ImageDiffSide from "./ImageDiffSide.vue";

const props = defineProps<{
  preview: ImagePreview;
  filename: string;
  baseLabel: string;
  headLabel: string;
  mode: "diff" | "full" | "since";
}>();

const fit = shallowRef(true);
const hasImageCandidate = computed(() => [props.preview.base, props.preview.head]
  .some((side) => side.kind === "image" || side.kind === "too-large"));
</script>

<template>
  <div v-if="!hasImageCandidate" class="binary-note">Binary file — diff cannot be displayed.</div>
  <div v-else-if="mode === 'since'" class="snapshot-note" role="status">
    No historical visual snapshot is available for images. Use “Changes against {{ baseLabel }}” to compare the current base and head images.
  </div>
  <div v-else class="image-diff">
    <div class="toolbar" role="toolbar" aria-label="Image preview size">
      <button type="button" :aria-pressed="fit" :class="{ active: fit }" @click="fit = true">Fit</button>
      <button type="button" :aria-pressed="!fit" :class="{ active: !fit }" @click="fit = false">Actual size</button>
    </div>
    <div class="sides">
      <ImageDiffSide
        v-if="mode === 'diff'"
        :side="preview.base"
        :label="baseLabel"
        :filename="filename"
        :fit="fit"
      />
      <ImageDiffSide
        :side="preview.head"
        :label="headLabel"
        :filename="filename"
        :fit="fit"
      />
    </div>
  </div>
</template>

<style scoped>
.image-diff { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; }
.toolbar { display: flex; flex: none; justify-content: flex-end; gap: 2px; padding: 5px 10px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); }
.toolbar button { border: 0; border-radius: 4px; padding: 3px 8px; background: transparent; color: var(--muted-foreground); font-size: 11px; cursor: pointer; }
.toolbar button:hover, .toolbar button.active { background: var(--elevated-background); color: var(--workbench-foreground); }
.toolbar button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.sides { display: flex; flex: 1; min-width: 0; min-height: 0; }
.snapshot-note, .binary-note { display: flex; flex: 1; align-items: center; justify-content: center; padding: 32px; color: var(--faint-foreground); font-size: 13px; text-align: center; }
.snapshot-note { color: var(--warning); background: var(--warning-background); }
</style>
