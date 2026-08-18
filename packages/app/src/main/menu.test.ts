import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { buildMenuTemplate } from "./menu.js";

function submenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  return item.submenu as MenuItemConstructorOptions[];
}

describe("application menu", () => {
  const actions = () => ({
    openSettings: vi.fn(),
    setZoom: vi.fn(),
    currentZoom: vi.fn(() => 0),
  });

  it("puts Settings in the macOS application menu with Cmd+,", () => {
    const callbacks = actions();
    const template = buildMenuTemplate("darwin", "Gander", callbacks);
    const settings = submenu(template[0]!).find((item) => item.label === "Settings…");

    expect(template[0]?.label).toBe("Gander");
    expect(settings?.accelerator).toBe("Command+,");
    settings?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    expect(callbacks.openSettings).toHaveBeenCalledOnce();
  });

  it.each(["win32", "linux"] as const)("puts Settings under File > Preferences with Ctrl+, on %s", (platform) => {
    const callbacks = actions();
    const template = buildMenuTemplate(platform, "Gander", callbacks);
    const preferences = submenu(template[0]!).find((item) => item.label === "Preferences");
    const settings = submenu(preferences!).find((item) => item.label === "Settings");

    expect(template[0]?.label).toBe("File");
    expect(settings?.accelerator).toBe("Control+,");
    settings?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
    expect(callbacks.openSettings).toHaveBeenCalledOnce();
  });

  it("routes every View zoom command through the shared zoom actions", () => {
    const callbacks = actions();
    callbacks.currentZoom.mockReturnValue(1);
    const template = buildMenuTemplate("darwin", "Gander", callbacks);
    const view = template.find((item) => item.label === "View");
    const items = submenu(view!);

    items.find((item) => item.label === "Zoom In" && item.visible !== false)?.click?.(
      {} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent,
    );
    expect(callbacks.setZoom).toHaveBeenLastCalledWith(1.5);
    items.find((item) => item.label === "Zoom Out")?.click?.(
      {} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent,
    );
    expect(callbacks.setZoom).toHaveBeenLastCalledWith(0.5);
    items.find((item) => item.label === "Actual Size")?.click?.(
      {} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent,
    );
    expect(callbacks.setZoom).toHaveBeenLastCalledWith(0);
  });
});
