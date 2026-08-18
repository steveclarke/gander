import type { editor } from "monaco-editor";
import { themeFor, type GanderTheme, type ThemeId } from "../../themes.js";

export interface MonacoThemeApi {
  defineTheme(themeName: string, themeData: editor.IStandaloneThemeData): void;
  setTheme(themeName: string): void;
}

const cssTokenNames: Readonly<Record<keyof GanderTheme["workbench"], string>> = {
  background: "--workbench-background",
  panelBackground: "--panel-background",
  secondaryPanelBackground: "--secondary-panel-background",
  elevatedBackground: "--elevated-background",
  inputBackground: "--input-background",
  badgeBackground: "--badge-background",
  border: "--workbench-border",
  foreground: "--workbench-foreground",
  mutedForeground: "--muted-foreground",
  faintForeground: "--faint-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  success: "--success",
  danger: "--danger",
  warning: "--warning",
  info: "--info",
  hoverBackground: "--hover-background",
  selectionBackground: "--selection-background",
  focusRing: "--focus-ring",
  overlay: "--overlay-background",
  shadow: "--workbench-shadow",
  successBackground: "--success-background",
  dangerBackground: "--danger-background",
  warningBackground: "--warning-background",
  addedGutterBackground: "--added-gutter-background",
  deletedGutterBackground: "--deleted-gutter-background",
};

export function applyWorkbenchTheme(theme: GanderTheme, root: HTMLElement): void {
  for (const key of Object.keys(cssTokenNames) as (keyof GanderTheme["workbench"])[]) {
    root.style.setProperty(cssTokenNames[key], theme.workbench[key]);
  }
  root.dataset.colorTheme = theme.id;
  root.style.colorScheme = theme.monaco.base === "vs" ? "light" : "dark";
}

export function applyAppTheme(
  themeId: ThemeId,
  root: HTMLElement,
  monacoThemeApi: MonacoThemeApi,
): void {
  const theme = themeFor(themeId);
  applyWorkbenchTheme(theme, root);
  monacoThemeApi.defineTheme(theme.monacoName, theme.monaco);
  monacoThemeApi.setTheme(theme.monacoName);
}
