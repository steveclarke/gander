<script setup lang="ts">
import { ref } from "vue";
import { clamp } from "../layout.js";

const props = defineProps<{
  /** "vertical" is a vertical bar dragged left and right; "horizontal" is dragged up and down. */
  orientation: "vertical" | "horizontal";
  modelValue: number;
  min: number;
  max: number;
  /** Dragging away from the origin makes the panel smaller — true for a panel docked right or bottom. */
  inverted?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [number] }>();

const dragging = ref(false);

function start(e: PointerEvent): void {
  dragging.value = true;
  const startPos = props.orientation === "vertical" ? e.clientX : e.clientY;
  const startSize = props.modelValue;
  // Pointer capture keeps the drag alive over the Monaco iframe-like surface and past the
  // window edge; without it the panel sticks the moment the cursor leaves the 5px handle.
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);

  const move = (ev: PointerEvent): void => {
    const pos = props.orientation === "vertical" ? ev.clientX : ev.clientY;
    const delta = (pos - startPos) * (props.inverted === true ? -1 : 1);
    emit("update:modelValue", clamp(startSize + delta, props.min, props.max));
  };
  const end = (): void => {
    dragging.value = false;
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
}
</script>

<template>
  <div
    class="splitter"
    :class="[orientation, { dragging }]"
    role="separator"
    :aria-orientation="orientation"
    @pointerdown.prevent="start"
  />
</template>

<style scoped>
/* The hit area is wider than the visible line — a 1px target is miserable to grab. */
.splitter { background: transparent; flex: none; position: relative; z-index: 5; }
.splitter.vertical { width: 6px; cursor: col-resize; margin: 0 -3px; }
.splitter.horizontal { height: 6px; cursor: row-resize; margin: -3px 0; }
.splitter::after { content: ""; position: absolute; inset: 0; background: transparent; transition: background .12s; }
.splitter.vertical::after { left: 2px; right: 2px; }
.splitter.horizontal::after { top: 2px; bottom: 2px; }
.splitter:hover::after, .splitter.dragging::after { background: var(--accent); }
</style>
