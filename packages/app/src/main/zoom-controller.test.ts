import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "../settings.js";
import { ZOOM_LEVEL_MAX } from "../zoom.js";
import type { GanderConfig } from "./config.js";
import { createZoomController } from "./zoom-controller.js";

describe("zoom controller", () => {
  it("persists, applies, and announces one clamped zoom state to every window", () => {
    const cfg: GanderConfig = {
      serviceUrl: "",
      serviceToken: "",
      repos: [],
      settings: DEFAULT_APP_SETTINGS,
    };
    const windows = [
      { webContents: { setZoomLevel: vi.fn(), send: vi.fn() } },
      { webContents: { setZoomLevel: vi.fn(), send: vi.fn() } },
    ];
    const persist = vi.fn();
    const zoom = createZoomController(cfg, () => windows, persist);

    expect(zoom.set(100)).toBe(ZOOM_LEVEL_MAX);
    expect(zoom.current()).toBe(ZOOM_LEVEL_MAX);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ window: { zoomLevel: ZOOM_LEVEL_MAX } }),
    }));
    for (const window of windows) {
      expect(window.webContents.setZoomLevel).toHaveBeenCalledWith(ZOOM_LEVEL_MAX);
      expect(window.webContents.send).toHaveBeenCalledWith("gander:zoomChanged", ZOOM_LEVEL_MAX);
    }
  });

  it("applies a settings change without persisting it twice", () => {
    const cfg: GanderConfig = {
      serviceUrl: "",
      serviceToken: "",
      repos: [],
      settings: DEFAULT_APP_SETTINGS,
    };
    const window = { webContents: { setZoomLevel: vi.fn(), send: vi.fn() } };
    const persist = vi.fn();
    const zoom = createZoomController(cfg, () => [window], persist);

    zoom.apply(-0.5);

    expect(persist).not.toHaveBeenCalled();
    expect(window.webContents.setZoomLevel).toHaveBeenCalledWith(-0.5);
    expect(window.webContents.send).toHaveBeenCalledWith("gander:zoomChanged", -0.5);
  });
});
