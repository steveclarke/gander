<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import type { ImageSide } from "../../../api.js";

const props = defineProps<{
  side: ImageSide;
  label: string;
  filename: string;
  fit: boolean;
}>();

const objectUrl = shallowRef<string | null>(null);
const width = shallowRef<number | null>(null);
const height = shallowRef<number | null>(null);
const decodeFailed = shallowRef(false);

function releaseUrl(): void {
  if (objectUrl.value !== null) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = null;
}

watch(() => props.side, (side) => {
  releaseUrl();
  width.value = null;
  height.value = null;
  decodeFailed.value = false;
  if (side.kind !== "image") return;
  const bytes = side.bytes.slice();
  objectUrl.value = URL.createObjectURL(new Blob([bytes.buffer], { type: side.mediaType }));
}, { immediate: true });

onBeforeUnmount(releaseUrl);

const size = computed(() => props.side.kind === "absent" ? null : props.side.size);
const metadata = computed(() => {
  const parts: string[] = [];
  if (width.value !== null && height.value !== null) parts.push(`${width.value} × ${height.value}`);
  if (size.value !== null) parts.push(formatBytes(size.value));
  return parts.join(" · ");
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loaded(event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  width.value = image.naturalWidth;
  height.value = image.naturalHeight;
}
</script>

<template>
  <section class="side" :aria-label="label">
    <header class="side-head">
      <strong>{{ label }}</strong>
      <span v-if="side.kind !== 'absent'" class="filename">{{ filename }}</span>
      <span v-if="metadata" class="metadata">{{ metadata }}</span>
    </header>
    <div v-if="side.kind === 'absent'" class="fallback">No image on this side.</div>
    <div v-else-if="side.kind === 'too-large'" class="fallback" role="status">
      Image is too large to preview ({{ formatBytes(side.size) }}; limit {{ formatBytes(side.limit) }}).
    </div>
    <div v-else-if="side.kind === 'unsupported'" class="fallback">Not a supported image.</div>
    <div v-else class="viewport">
      <div v-if="decodeFailed" class="fallback" role="status">Image could not be decoded.</div>
      <img
        v-else-if="objectUrl"
        :src="objectUrl"
        :alt="`${label} preview of ${filename}`"
        :class="{ fit }"
        @load="loaded"
        @error="decodeFailed = true"
      />
    </div>
  </section>
</template>

<style scoped>
.side { display: flex; flex: 1 1 0; min-width: 0; min-height: 0; flex-direction: column; border-right: 1px solid var(--workbench-border); }
.side:last-child { border-right: 0; }
.side-head { display: flex; min-height: 34px; flex: none; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); font-size: 11px; }
.side-head strong { color: var(--workbench-foreground); text-transform: uppercase; letter-spacing: 0.04em; }
.filename { overflow: hidden; color: var(--muted-foreground); font-family: var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.metadata { margin-left: auto; flex: none; color: var(--faint-foreground); font-variant-numeric: tabular-nums; }
.viewport { flex: 1; min-width: 0; min-height: 0; overflow: auto; display: flex; align-items: flex-start; justify-content: flex-start; padding: 20px; background-color: #fff; background-image: linear-gradient(45deg, #d8d8d8 25%, transparent 25%), linear-gradient(-45deg, #d8d8d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d8d8d8 75%), linear-gradient(-45deg, transparent 75%, #d8d8d8 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.viewport img { display: block; flex: none; max-width: none; max-height: none; }
.viewport img.fit { max-width: 100%; max-height: 100%; margin: auto; object-fit: contain; }
.viewport > .fallback { width: 100%; height: 100%; }
.fallback { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--faint-foreground); font-size: 13px; text-align: center; }
</style>
