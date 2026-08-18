import { reactive } from "vue";
import * as monaco from "monaco-editor";
import type { GanderApi } from "./api.js";
import { DEFAULT_APP_SETTINGS, parseAppSettings, type AppSettings, type ThemeId } from "../../settings.js";
import { applyAppTheme } from "./theme-runtime.js";

export interface EditorSettingsStore {
  settings: AppSettings;
  busy: boolean;
  error: string | null;
  load(): Promise<void>;
  update(settings: AppSettings): Promise<boolean>;
}

function applyCodeSurfaceSettings(settings: AppSettings): void {
  document.documentElement.style.setProperty("--editor-font-family", settings.editor.fontFamily);
  document.documentElement.style.setProperty("--editor-font-size", `${settings.editor.fontSize}px`);
  applyAppTheme(settings.workbench.colorTheme, document.documentElement, monaco.editor);
}

export function createEditorSettingsStore(
  api: Pick<GanderApi, "getSettings" | "updateSettings">,
  initialColorTheme: ThemeId = DEFAULT_APP_SETTINGS.workbench.colorTheme,
): EditorSettingsStore {
  const initialSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    workbench: { ...DEFAULT_APP_SETTINGS.workbench, colorTheme: initialColorTheme },
  };
  const store: EditorSettingsStore = reactive({
    settings: initialSettings,
    busy: false,
    error: null,

    async load() {
      try {
        store.settings = await api.getSettings();
        applyCodeSurfaceSettings(store.settings);
      } catch (error) {
        store.error = (error as Error).message;
      }
    },

    async update(settings: AppSettings) {
      store.busy = true;
      store.error = null;
      try {
        // Vue makes nested settings objects reactive. Normalize through the shared
        // schema so Electron receives plain cloneable data from every settings view.
        store.settings = await api.updateSettings(parseAppSettings(settings));
        applyCodeSurfaceSettings(store.settings);
        return true;
      } catch (error) {
        store.error = (error as Error).message;
        return false;
      } finally {
        store.busy = false;
      }
    },
  });

  applyCodeSurfaceSettings(store.settings);
  return store;
}
