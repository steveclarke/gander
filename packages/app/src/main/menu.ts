import type { MenuItemConstructorOptions } from "electron";
import { DEFAULT_ZOOM_LEVEL, ZOOM_LEVEL_STEP } from "../zoom.js";

interface MenuActions {
  openSettings(): void;
  newWindow(): void;
  newTab(): void;
  setZoom(level: number): void;
  currentZoom(): number;
  checkForUpdates?: () => void;
}

export function buildMenuTemplate(
  platform: NodeJS.Platform,
  appName: string,
  actions: MenuActions,
): MenuItemConstructorOptions[] {
  const settingsItem: MenuItemConstructorOptions = {
    id: "settings",
    label: platform === "darwin" ? "Settings…" : "Settings",
    accelerator: platform === "darwin" ? "Command+," : "Control+,",
    click: actions.openSettings,
  };

  const newWindowItem: MenuItemConstructorOptions = {
    label: "New Window", accelerator: "CommandOrControl+Shift+N", click: actions.newWindow,
  };
  // Tabs are the macOS window tabs; elsewhere a new window is the whole story.
  const newItems: MenuItemConstructorOptions[] = platform === "darwin"
    ? [{ label: "New Tab", accelerator: "Command+T", click: actions.newTab }, newWindowItem]
    : [newWindowItem];

  const applicationMenu: MenuItemConstructorOptions = platform === "darwin"
    ? {
        label: appName,
        submenu: [
          { role: "about" },
          ...(actions.checkForUpdates
            ? [{ label: "Check for Updates…", click: actions.checkForUpdates } satisfies MenuItemConstructorOptions]
            : []),
          { type: "separator" },
          settingsItem,
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      }
    : {
        label: "File",
        submenu: [
          ...newItems,
          { type: "separator" },
          { label: "Preferences", submenu: [settingsItem] },
          { type: "separator" },
          { role: "quit" },
        ],
      };

  const helpMenu: MenuItemConstructorOptions[] = actions.checkForUpdates && platform !== "darwin"
    ? [{ label: "Help", submenu: [{ label: "Check for Updates…", click: actions.checkForUpdates }] }]
    : [];

  return [
    applicationMenu,
    ...(platform === "darwin" ? [{ label: "File", submenu: [...newItems, { type: "separator" }, { role: "close" }] } satisfies MenuItemConstructorOptions] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: () => actions.setZoom(actions.currentZoom() + ZOOM_LEVEL_STEP) },
        // Chromium delivers Cmd+= for an unshifted Cmd+ on most layouts; both are bound
        // so the key next to Backspace works without reaching for Shift.
        { label: "Zoom In", accelerator: "CommandOrControl+=", visible: false, click: () => actions.setZoom(actions.currentZoom() + ZOOM_LEVEL_STEP) },
        { label: "Zoom Out", accelerator: "CommandOrControl+-", click: () => actions.setZoom(actions.currentZoom() - ZOOM_LEVEL_STEP) },
        { label: "Actual Size", accelerator: "CommandOrControl+0", click: () => actions.setZoom(DEFAULT_ZOOM_LEVEL) },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
    ...helpMenu,
  ];
}
