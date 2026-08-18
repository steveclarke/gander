import type { BrowserWindowConstructorOptions } from "electron";
import {
  COLOR_THEME_ARGUMENT,
  WINDOW_STYLE_ARGUMENT,
  type InitialWindowState,
} from "../api.js";
import { themeFor, type ThemeId } from "../themes.js";

export interface WindowAppearance {
  windowOptions: Pick<BrowserWindowConstructorOptions, "backgroundColor" | "show" | "titleBarStyle">;
  preloadArguments: string[];
}

interface ThemeableWindow {
  setBackgroundColor(color: string): void;
}

export function windowAppearance(platform: NodeJS.Platform, themeId: ThemeId): WindowAppearance {
  const theme = themeFor(themeId);
  const windowStyle: InitialWindowState["windowStyle"] =
    platform === "darwin" ? "integrated-titlebar" : "native-titlebar";

  return {
    windowOptions: platform === "darwin"
      ? {
          backgroundColor: theme.workbench.background,
          show: false,
          titleBarStyle: "hiddenInset",
        }
      : { backgroundColor: theme.workbench.background },
    preloadArguments: [
      `${WINDOW_STYLE_ARGUMENT}${windowStyle}`,
      `${COLOR_THEME_ARGUMENT}${encodeURIComponent(themeId)}`,
    ],
  };
}

export function updateNativeWindowTheme(
  platform: NodeJS.Platform,
  windows: ThemeableWindow[],
  themeId: ThemeId,
): void {
  if (platform !== "darwin") return;
  const background = themeFor(themeId).workbench.background;
  for (const window of windows) window.setBackgroundColor(background);
}
