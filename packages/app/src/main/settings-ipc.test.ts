import type { IpcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { GanderConfig } from "./config.js";
import { registerSettingsIpc } from "./settings-ipc.js";
import { DEFAULT_APP_SETTINGS } from "../settings.js";

type Handler = (...args: unknown[]) => unknown;

function fixture(): {
  cfg: GanderConfig;
  handlers: Map<string, Handler>;
  persist: ReturnType<typeof vi.fn>;
  onSettingsChanged: ReturnType<typeof vi.fn>;
} {
  const cfg: GanderConfig = {
    serviceUrl: "http://localhost:8390",
    serviceToken: "token",
    repos: [],
    settings: DEFAULT_APP_SETTINGS,
  };
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle(channel: string, handler: Handler) { handlers.set(channel, handler); },
  } as unknown as Pick<IpcMain, "handle">;
  const persist = vi.fn();
  const onSettingsChanged = vi.fn();
  registerSettingsIpc(ipc, cfg, persist, onSettingsChanged);
  return { cfg, handlers, persist, onSettingsChanged };
}

describe("settings IPC", () => {
  it("returns current settings and persists a validated update", async () => {
    const { cfg, handlers, persist, onSettingsChanged } = fixture();
    await expect(handlers.get("gander:getSettings")?.()).resolves.toEqual(DEFAULT_APP_SETTINGS);

    const next = {
      editor: { fontFamily: "Consolas, monospace", fontSize: 20 },
      workbench: {
        colorTheme: "Gander Dark" as const,
        iconTheme: "catppuccin-mocha" as const,
        tree: { fontFamily: "system-ui", fontSize: 14, inheritEditorTypography: false },
      },
    };
    await expect(handlers.get("gander:updateSettings")?.({}, next)).resolves.toEqual(next);
    expect(cfg.settings).toEqual(next);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(cfg);
    expect(onSettingsChanged).toHaveBeenCalledWith(next);
  });

  it("rejects invalid renderer input without changing or saving settings", async () => {
    const { cfg, handlers, persist, onSettingsChanged } = fixture();
    await expect(handlers.get("gander:updateSettings")?.({}, {
      editor: { fontFamily: "monospace", fontSize: 200 },
      workbench: DEFAULT_APP_SETTINGS.workbench,
    })).rejects.toThrow(/fontSize/);
    expect(cfg.settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(persist).not.toHaveBeenCalled();
    expect(onSettingsChanged).not.toHaveBeenCalled();
  });

  it("keeps the previous in-memory settings when persistence fails", async () => {
    const { cfg, handlers, persist, onSettingsChanged } = fixture();
    persist.mockImplementation(() => { throw new Error("disk full"); });
    await expect(handlers.get("gander:updateSettings")?.({}, {
      editor: { fontFamily: "Consolas, monospace", fontSize: 20 },
      workbench: DEFAULT_APP_SETTINGS.workbench,
    })).rejects.toThrow(/disk full/);
    expect(cfg.settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(onSettingsChanged).not.toHaveBeenCalled();
  });
});
