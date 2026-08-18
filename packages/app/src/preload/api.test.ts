import { describe, expect, it, vi } from "vitest";
import { createGanderApi } from "./api.js";
import { DEFAULT_APP_SETTINGS } from "../settings.js";

describe("preload API", () => {
  it("routes typed settings calls through their namespaced IPC channels", async () => {
    const invoke = vi.fn(async () => ({ editor: { fontFamily: "monospace", fontSize: 16 } }));
    const api = createGanderApi(invoke, vi.fn());

    await api.getSettings();
    expect(invoke).toHaveBeenLastCalledWith("gander:getSettings");

    const settings = {
      editor: { fontFamily: "Fira Code, monospace", fontSize: 17 },
      workbench: { ...DEFAULT_APP_SETTINGS.workbench, colorTheme: "Gander Dark" as const },
    };
    await api.updateSettings(settings);
    expect(invoke).toHaveBeenLastCalledWith("gander:updateSettings", settings);
  });

  it("routes reviewer replies through the reply IPC channel", async () => {
    const invoke = vi.fn(async () => ({}));
    const api = createGanderApi(invoke, vi.fn());

    await api.addReviewerReply("acme/atlas", 7, 12, "A reviewer reply");
    expect(invoke).toHaveBeenLastCalledWith("gander:addReviewerReply", "acme/atlas", 7, 12, "A reviewer reply");
  });

  it("routes launch targets and subscribes to later open-target events", async () => {
    const invoke = vi.fn(async () => ({ repoId: "acme/atlas", prNumber: 4 }));
    const cleanup = vi.fn();
    let subscribed: ((...args: any[]) => void) | undefined;
    const subscribe: Parameters<typeof createGanderApi>[1] = vi.fn((_channel, listener) => {
      subscribed = listener;
      return cleanup;
    });
    const api = createGanderApi(invoke, subscribe);
    const listener = vi.fn();

    await api.initialTarget();
    expect(invoke).toHaveBeenLastCalledWith("gander:initialTarget");
    expect(api.onOpenTarget(listener)).toBe(cleanup);
    expect(subscribe).toHaveBeenCalledWith("gander:openTarget", expect.any(Function));
    subscribed?.({ repoId: "acme/atlas", prNumber: 4 });
    expect(listener).toHaveBeenCalledWith({ repoId: "acme/atlas", prNumber: 4 });
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
