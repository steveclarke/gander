import type { IpcMain } from "electron";
import type { GanderConfig } from "./config.js";
import { saveConfig } from "./config.js";
import { parseAppSettings, type AppSettings } from "../settings.js";

type SettingsIpc = Pick<IpcMain, "handle">;

export function registerSettingsIpc(
  ipc: SettingsIpc,
  cfg: GanderConfig,
  persist: (config: GanderConfig) => void = saveConfig,
  onSettingsChanged: (settings: AppSettings) => void = () => {},
): void {
  ipc.handle("gander:getSettings", async () => cfg.settings);
  ipc.handle("gander:updateSettings", async (_event, value: unknown): Promise<AppSettings> => {
    const settings = parseAppSettings(value);
    // Keep the running app consistent with disk when persistence fails. The renderer
    // receives the write error and the previous in-memory settings remain authoritative.
    persist({ ...cfg, settings });
    cfg.settings = settings;
    onSettingsChanged(settings);
    return settings;
  });
}
