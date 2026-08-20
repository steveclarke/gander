<script setup lang="ts">
import { computed } from "vue";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { DEFAULT_APP_SETTINGS, type FileIconThemeId, type ThemeId } from "../../../settings.js";
import { THEME_IDS, themeFor } from "../../../themes.js";
import { FILE_ICON_THEME_IDS, fileIconThemeFor } from "../../../file-icon-themes.js";
import SettingsField from "./SettingsField.vue";
import TreeTypographySettings from "./TreeTypographySettings.vue";
import WindowZoomSettings from "./WindowZoomSettings.vue";

const props = defineProps<{ store: EditorSettingsStore }>();
const emit = defineEmits<{ saved: [success: boolean] }>();

const activeTheme = computed(() => themeFor(props.store.settings.workbench.colorTheme));
const themes = THEME_IDS.map(themeFor);
const iconThemes = FILE_ICON_THEME_IDS.map(fileIconThemeFor);
const activeIconTheme = computed(() => fileIconThemeFor(props.store.settings.workbench.iconTheme));

async function selectTheme(event: Event): Promise<void> {
  const colorTheme = (event.currentTarget as HTMLSelectElement).value as ThemeId;
  emit("saved", await props.store.update({
    ...props.store.settings,
    workbench: { ...props.store.settings.workbench, colorTheme },
  }));
}

async function selectIconTheme(event: Event): Promise<void> {
  const iconTheme = (event.currentTarget as HTMLSelectElement).value as FileIconThemeId;
  emit("saved", await props.store.update({
    ...props.store.settings,
    workbench: { ...props.store.settings.workbench, iconTheme },
  }));
}

async function reset(): Promise<void> {
  emit("saved", await props.store.update({
    ...props.store.settings,
    workbench: DEFAULT_APP_SETTINGS.workbench,
  }));
}
</script>

<template>
  <section class="settings-page workbench-settings" aria-labelledby="workbench-settings-title">
    <header class="settings-page-heading">
      <div>
        <h2 id="workbench-settings-title" class="settings-page-title">Workbench</h2>
        <p class="settings-description">Colors for Gander's interface and code surfaces.</p>
      </div>
      <button class="settings-reset" type="button" :disabled="store.busy" @click="reset">Use default</button>
    </header>

    <SettingsField id="workbench-color-theme" label="Color theme">
      <template #description>
        Controls <code class="settings-code">workbench.colorTheme</code>. Themes are bundled with Gander.
      </template>
      <template #control>
        <select
          id="workbench-color-theme"
          class="settings-control settings-select"
          name="workbench.colorTheme"
          :value="store.settings.workbench.colorTheme"
          :disabled="store.busy"
          @change="selectTheme"
        >
          <option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
        </select>
      </template>
      <template #footer>
        <p class="settings-description source">Source: {{ activeTheme.source }}</p>
      </template>
    </SettingsField>

    <SettingsField id="workbench-icon-theme" label="File icon theme">
      <template #description>
        Controls <code class="settings-code">workbench.iconTheme</code>. Icon themes are bundled with Gander.
      </template>
      <template #control>
        <select
          id="workbench-icon-theme"
          class="settings-control settings-select"
          name="workbench.iconTheme"
          :value="store.settings.workbench.iconTheme"
          :disabled="store.busy"
          @change="selectIconTheme"
        >
          <option v-for="theme in iconThemes" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
        </select>
      </template>
      <template #footer>
        <p class="settings-description source">Source: {{ activeIconTheme.source }}</p>
      </template>
    </SettingsField>

    <div class="swatches" role="img" :aria-label="`${activeTheme.label} color palette`">
      <span v-for="(color, token) in activeTheme.workbench" :key="token" :style="{ backgroundColor: color }" />
    </div>

    <WindowZoomSettings :store="store" @saved="emit('saved', $event)" />
    <TreeTypographySettings :store="store" @saved="emit('saved', $event)" />
  </section>
</template>

<style scoped>
.settings-select {
  width: min(420px, 100%); margin-top: 8px; padding: 8px 34px 8px 10px;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-md);
  background: var(--input-background); color: var(--workbench-foreground); font: inherit; font-size: 13px;
}
.source { margin-top: 7px; }
.swatches { display: flex; width: min(420px, 100%); height: 36px; overflow: hidden; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); }
.swatches span { flex: 1; min-width: 2px; }
</style>
