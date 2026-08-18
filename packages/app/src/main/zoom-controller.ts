import type { GanderConfig } from "./config.js";
import { saveConfig } from "./config.js";
import { clampZoomLevel } from "../zoom.js";

interface ZoomWindow {
  webContents: {
    setZoomLevel(level: number): void;
    send(channel: string, level: number): void;
  };
}

export interface ZoomController {
  current(): number;
  set(level: number): number;
  apply(level: number): number;
}

export function createZoomController(
  cfg: GanderConfig,
  windows: () => ZoomWindow[],
  persist: (config: GanderConfig) => void = saveConfig,
): ZoomController {
  const apply = (level: number): number => {
    const clamped = clampZoomLevel(level);
    for (const window of windows()) {
      window.webContents.setZoomLevel(clamped);
      window.webContents.send("gander:zoomChanged", clamped);
    }
    return clamped;
  };

  return {
    current: () => cfg.settings.window.zoomLevel,
    set(level) {
      const clamped = clampZoomLevel(level);
      const settings = {
        ...cfg.settings,
        window: { ...cfg.settings.window, zoomLevel: clamped },
      };
      // Persist before changing the running app so disk and memory remain authoritative
      // together if the settings file cannot be written.
      persist({ ...cfg, settings });
      cfg.settings = settings;
      return apply(clamped);
    },
    apply,
  };
}
