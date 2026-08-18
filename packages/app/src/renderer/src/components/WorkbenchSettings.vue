<script setup lang="ts">
import { computed } from "vue";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { DEFAULT_APP_SETTINGS, type FileIconThemeId, type ThemeId } from "../../../settings.js";
import { THEME_IDS, themeFor } from "../../../themes.js";
import { FILE_ICON_THEME_IDS, fileIconThemeFor } from "../../../file-icon-themes.js";

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
  <section class="workbench-settings" aria-labelledby="workbench-settings-title">
    <header class="heading">
      <div>
        <h2 id="workbench-settings-title">Workbench</h2>
        <p>Colors for Gander's interface and code surfaces.</p>
      </div>
      <button class="reset" type="button" :disabled="store.busy" @click="reset">Use default</button>
    </header>

    <div class="setting">
      <label for="workbench-color-theme">Color theme</label>
      <p>Controls <code>workbench.colorTheme</code>. Themes are bundled with Gander.</p>
      <select
        id="workbench-color-theme"
        name="workbench.colorTheme"
        :value="store.settings.workbench.colorTheme"
        :disabled="store.busy"
        @change="selectTheme"
      >
        <option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
      </select>
      <p class="source">Source: {{ activeTheme.source }}</p>
    </div>

    <div class="setting">
      <label for="workbench-icon-theme">File icon theme</label>
      <p>Controls <code>workbench.iconTheme</code>. Icon themes are bundled with Gander.</p>
      <select
        id="workbench-icon-theme"
        name="workbench.iconTheme"
        :value="store.settings.workbench.iconTheme"
        :disabled="store.busy"
        @change="selectIconTheme"
      >
        <option v-for="theme in iconThemes" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
      </select>
      <p class="source">Source: {{ activeIconTheme.source }}</p>
    </div>

    <div class="swatches" role="img" :aria-label="`${activeTheme.label} color palette`">
      <span v-for="(color, token) in activeTheme.workbench" :key="token" :style="{ backgroundColor: color }" />
    </div>
  </section>
</template>

<style scoped>
.workbench-settings { height: 100%; overflow: auto; padding: 28px; }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; max-width: 820px; margin-bottom: 30px; }
.heading h2 { color: var(--workbench-foreground); font-size: 20px; line-height: 1.25; }
.heading p, .setting > p { color: var(--faint-foreground); font-size: 12px; }
.reset { border: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
.reset:disabled { cursor: default; opacity: .55; }
.reset:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.setting { max-width: 820px; margin-bottom: 24px; }
.setting label { display: block; color: var(--workbench-foreground); font-size: 13px; font-weight: 650; margin-bottom: 2px; }
.setting code { color: var(--muted-foreground); font: 11.5px var(--mono); }
.setting select {
  width: min(420px, 100%); margin-top: 8px; padding: 8px 34px 8px 10px;
  border: 1px solid var(--workbench-border); border-radius: 6px;
  outline: none; background: var(--input-background); color: var(--workbench-foreground); font: inherit; font-size: 13px;
}
.setting select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--focus-ring); }
.source { margin-top: 7px; }
.swatches { display: flex; width: min(420px, 100%); height: 36px; overflow: hidden; border: 1px solid var(--workbench-border); border-radius: 6px; }
.swatches span { flex: 1; min-width: 2px; }
</style>
