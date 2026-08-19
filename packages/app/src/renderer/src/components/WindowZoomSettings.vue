<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from "vue";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { DEFAULT_APP_SETTINGS } from "../../../settings.js";
import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN, zoomPercentage } from "../../../zoom.js";

const props = defineProps<{ store: EditorSettingsStore }>();
const emit = defineEmits<{ saved: [success: boolean] }>();

const zoomLevel = shallowRef<number | string>(props.store.settings.window.zoomLevel);
const localError = shallowRef<string | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.store.settings.window.zoomLevel,
  (level) => { zoomLevel.value = level; },
);

async function save(): Promise<void> {
  const level = Number(zoomLevel.value);
  if (!Number.isFinite(level) || level < ZOOM_LEVEL_MIN || level > ZOOM_LEVEL_MAX) {
    localError.value = `Enter a zoom level from ${ZOOM_LEVEL_MIN} to ${ZOOM_LEVEL_MAX}.`;
    return;
  }
  localError.value = null;
  emit("saved", await props.store.update({
    ...props.store.settings,
    window: { ...props.store.settings.window, zoomLevel: level },
  }));
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save();
  }, 400);
}

function flushSave(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  void save();
}

async function reset(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  zoomLevel.value = DEFAULT_APP_SETTINGS.window.zoomLevel;
  localError.value = null;
  emit("saved", await props.store.update({
    ...props.store.settings,
    window: DEFAULT_APP_SETTINGS.window,
  }));
}

onBeforeUnmount(flushSave);
</script>

<template>
  <section class="settings-section window-zoom" aria-labelledby="window-zoom-title">
    <div class="settings-section-heading">
      <div>
        <h3 id="window-zoom-title" class="settings-section-title">Window zoom level</h3>
        <p class="settings-description">Sets the default scale for every Gander window.</p>
      </div>
      <button class="settings-reset" type="button" :disabled="store.busy" @click="reset">Use default</button>
    </div>

    <div class="settings-field">
      <label class="settings-label" for="window-zoom-level">Zoom level</label>
      <p class="settings-description">
        Controls <code class="settings-code">window.zoomLevel</code>. Each whole step changes the scale by 20%;
        decimals give finer control.
      </p>
      <div class="level-row">
        <input
          id="window-zoom-level"
          class="settings-control settings-text-control"
          v-model.number="zoomLevel"
          name="window.zoomLevel"
          type="number"
          :min="ZOOM_LEVEL_MIN"
          :max="ZOOM_LEVEL_MAX"
          step="0.1"
          :disabled="store.busy"
          aria-describedby="window-zoom-percentage"
          @input="scheduleSave"
          @change="flushSave"
        />
        <span id="window-zoom-percentage">{{ zoomPercentage(Number(zoomLevel) || 0) }}%</span>
      </div>
    </div>

    <p v-if="localError" class="settings-error" role="alert">{{ localError }}</p>
  </section>
</template>

<style scoped src="../styles/settings.css"></style>

<style scoped>
.level-row { display: flex; align-items: center; gap: 9px; width: 150px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.level-row span { margin-top: 8px; }
</style>
