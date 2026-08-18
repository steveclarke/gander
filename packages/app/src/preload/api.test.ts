import { describe, expect, it, vi } from "vitest";
import { createGanderApi } from "./api.js";

describe("preload API", () => {
  it("routes typed settings calls through their namespaced IPC channels", async () => {
    const invoke = vi.fn(async () => ({ editor: { fontFamily: "monospace", fontSize: 16 } }));
    const api = createGanderApi(invoke, vi.fn());

    await api.getSettings();
    expect(invoke).toHaveBeenLastCalledWith("gander:getSettings");

    const settings = { editor: { fontFamily: "Fira Code, monospace", fontSize: 17 } };
    await api.updateSettings(settings);
    expect(invoke).toHaveBeenLastCalledWith("gander:updateSettings", settings);
  });

  it("subscribes to the typed open-settings event and returns its cleanup", () => {
    const cleanup = vi.fn();
    const subscribe = vi.fn(() => cleanup);
    const api = createGanderApi(vi.fn(), subscribe);
    const listener = vi.fn();

    expect(api.onOpenSettings(listener)).toBe(cleanup);
    expect(subscribe).toHaveBeenCalledWith("gander:openSettings", listener);
  });
});
