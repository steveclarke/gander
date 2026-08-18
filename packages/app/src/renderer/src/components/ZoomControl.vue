<script setup lang="ts">
import { computed } from "vue";
import { Minus, Plus, Settings2, ZoomIn } from "lucide-vue-next";
import {
  DEFAULT_ZOOM_LEVEL,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  ZOOM_LEVEL_STEP,
  zoomPercentage,
} from "../../../zoom.js";

const props = defineProps<{ level: number }>();
const emit = defineEmits<{
  change: [level: number];
  openSettings: [];
}>();

const percentage = computed(() => zoomPercentage(props.level));
const atMinimum = computed(() => props.level <= ZOOM_LEVEL_MIN);
const atMaximum = computed(() => props.level >= ZOOM_LEVEL_MAX);

function zoomOut(): void {
  emit("change", props.level - ZOOM_LEVEL_STEP);
}

function zoomIn(): void {
  emit("change", props.level + ZOOM_LEVEL_STEP);
}

function reset(): void {
  emit("change", DEFAULT_ZOOM_LEVEL);
}
</script>

<template>
  <div class="zoom-control">
    <button
      class="zoom-trigger"
      type="button"
      popovertarget="zoom-toolbar"
      :aria-label="`Zoom: ${percentage}%`"
      :title="`Zoom: ${percentage}%`"
    >
      <ZoomIn :size="13" aria-hidden="true" />
      <span class="percentage">{{ percentage }}%</span>
    </button>

    <div id="zoom-toolbar" class="zoom-toolbar" popover="auto" role="group" aria-label="Window zoom controls">
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        :disabled="atMinimum"
        @click="zoomOut"
      >
        <Minus :size="16" aria-hidden="true" />
      </button>
      <button
        class="reset"
        type="button"
        aria-label="Reset zoom to 100%"
        title="Reset zoom to 100%"
        :disabled="level === DEFAULT_ZOOM_LEVEL"
        @click="reset"
      >
        {{ percentage }}%
        <span>Reset</span>
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        :disabled="atMaximum"
        @click="zoomIn"
      >
        <Plus :size="16" aria-hidden="true" />
      </button>
      <span class="divider" aria-hidden="true" />
      <button
        type="button"
        popovertarget="zoom-toolbar"
        popovertargetaction="hide"
        aria-label="Open window zoom settings"
        title="Open window zoom settings"
        @click="emit('openSettings')"
      >
        <Settings2 :size="15" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.zoom-control { display: flex; align-items: center; }
.zoom-trigger {
  anchor-name: --zoom-trigger;
  display: flex; align-items: center; gap: 4px; height: 22px; padding: 0 4px;
  border: 0; border-radius: 3px; background: transparent; color: var(--faint-foreground);
  cursor: pointer; font: inherit; font-variant-numeric: tabular-nums;
}
.zoom-trigger:hover, .zoom-trigger:focus-visible { background: var(--hover-background); color: var(--workbench-foreground); }
.zoom-trigger:focus-visible, .zoom-toolbar button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.percentage { min-width: 3.25ch; text-align: end; }
.zoom-toolbar {
  position: fixed; position-anchor: --zoom-trigger; position-area: block-start span-inline-start;
  margin: 0 0 7px; padding: 5px; border: 1px solid var(--workbench-border); border-radius: 7px;
  overflow: visible;
  background: var(--elevated-background); color: var(--workbench-foreground);
  box-shadow: 0 6px 18px var(--workbench-shadow);
}
.zoom-toolbar:popover-open { display: flex; align-items: center; gap: 2px; }
.zoom-toolbar::before {
  content: ""; position: absolute; inset-block-end: -5px; inset-inline-end: 22px;
  width: 8px; height: 8px; rotate: 45deg;
  border-inline-end: 1px solid var(--workbench-border); border-block-end: 1px solid var(--workbench-border);
  background: var(--elevated-background);
}
.zoom-toolbar button {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 6px;
  min-width: 28px; height: 28px; padding: 0 7px; border: 0; border-radius: 4px;
  background: transparent; color: var(--workbench-foreground); cursor: pointer; font: inherit;
}
.zoom-toolbar button:hover:not(:disabled) { background: var(--hover-background); }
.zoom-toolbar button:disabled { color: var(--faint-foreground); cursor: default; opacity: .55; }
.zoom-toolbar .reset { min-width: 94px; font-variant-numeric: tabular-nums; }
.reset span { color: var(--muted-foreground); }
.divider { width: 1px; height: 18px; margin: 0 2px; background: var(--workbench-border); }
@supports not (position-area: block-start) {
  .zoom-toolbar { inset: auto 8px 30px auto; }
}
</style>
