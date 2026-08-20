<script setup lang="ts">
import { shallowRef, watch } from "vue";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { DEFAULT_APP_SETTINGS } from "../../../settings.js";
import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN, zoomPercentage } from "../../../zoom.js";
import { useDebouncedSave } from "../composables/use-debounced-save.js";
import SettingsField from "./SettingsField.vue";

const props = defineProps<{ store: EditorSettingsStore }>();
const emit = defineEmits<{ saved: [success: boolean] }>();

const zoomLevel = shallowRef<number | string>(props.store.settings.window.zoomLevel);
const localError = shallowRef<string | null>(null);

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

const autoSave = useDebouncedSave(save);

async function reset(): Promise<void> {
  autoSave.cancel();
  zoomLevel.value = DEFAULT_APP_SETTINGS.window.zoomLevel;
  localError.value = null;
  emit("saved", await props.store.update({
    ...props.store.settings,
    window: DEFAULT_APP_SETTINGS.window,
  }));
}
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

    <SettingsField
      id="window-zoom-level"
      name="window.zoomLevel"
      label="Zoom level"
      type="number"
      :min="ZOOM_LEVEL_MIN"
      :max="ZOOM_LEVEL_MAX"
      step="0.1"
      :model-value="zoomLevel"
      :disabled="store.busy"
      described-by="window-zoom-percentage"
      :unit-width="150"
      @update:model-value="zoomLevel = $event; autoSave.schedule()"
      @change="autoSave.flush"
    >
      <template #description>
        Controls <code class="settings-code">window.zoomLevel</code>. Each whole step changes the scale by 20%;
        decimals give finer control.
      </template>
      <template #unit>
        <span id="window-zoom-percentage">{{ zoomPercentage(Number(zoomLevel) || 0) }}%</span>
      </template>
    </SettingsField>

    <p v-if="localError" class="settings-error" role="alert">{{ localError }}</p>
  </section>
</template>
