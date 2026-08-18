import { reactive } from "vue";
import type { GanderApi } from "./api.js";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../settings.js";

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
}

export function createEditorSettingsStore(api: Pick<GanderApi, "getSettings" | "updateSettings">): EditorSettingsStore {
  const store: EditorSettingsStore = reactive({
    settings: DEFAULT_APP_SETTINGS,
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
        store.settings = await api.updateSettings(settings);
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
