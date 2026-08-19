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
  <section class="window-zoom" aria-labelledby="window-zoom-title">
    <div class="section-heading">
      <div>
        <h3 id="window-zoom-title">Window zoom level</h3>
        <p>Sets the default scale for every Gander window.</p>
      </div>
      <button class="reset" type="button" :disabled="store.busy" @click="reset">Use default</button>
    </div>

    <div class="setting">
      <label for="window-zoom-level">Zoom level</label>
      <p>
        Controls <code>window.zoomLevel</code>. Each whole step changes the scale by 20%;
        decimals give finer control.
      </p>
      <div class="level-row">
        <input
          id="window-zoom-level"
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

    <p v-if="localError" class="error" role="alert">{{ localError }}</p>
  </section>
</template>

<style scoped>
.window-zoom { max-width: 820px; margin-top: 34px; padding-top: 28px; border-top: 1px solid var(--workbench-border); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.section-heading h3 { color: var(--workbench-foreground); font-size: 15px; line-height: 1.3; }
.section-heading p, .setting > p { color: var(--faint-foreground); font-size: 12px; }
.reset { border: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
.reset:disabled { cursor: default; opacity: .55; }
.reset:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.setting { margin-bottom: 22px; }
.setting label { display: block; color: var(--workbench-foreground); font-size: 13px; font-weight: 650; margin-bottom: 2px; }
.setting code { color: var(--muted-foreground); font: 11.5px var(--mono); }
.level-row { display: flex; align-items: center; gap: 9px; width: 150px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.level-row input {
  width: 100%; min-width: 0; margin-top: 8px; padding: 8px 10px;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-md);
  outline: none; background: var(--input-background); color: var(--workbench-foreground); font: 13px/1.4 var(--mono);
}
.level-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--focus-ring); }
.level-row input:disabled { opacity: .65; }
.level-row span { margin-top: 8px; }
.error { color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
</style>
