import { describe, expect, it, vi } from "vitest";
import { createGanderApi, initialWindowStateFromArguments } from "./api.js";
import { DEFAULT_APP_SETTINGS } from "../settings.js";

describe("preload API", () => {
  it("exposes only main-selected window style and validated initial theme", () => {
    const state = initialWindowStateFromArguments([
      "--gander-window-style=integrated-titlebar",
      "--gander-color-theme=Gander%20Dark",
      "--gander-development",
      "--gander-worktree-label=feature%2Freview-status",
    ]);
    const api = createGanderApi(vi.fn(), vi.fn(), state);

    expect(api.initialWindowState).toEqual({
      windowStyle: "integrated-titlebar",
      colorTheme: "Gander Dark",
      isDevelopment: true,
      worktreeLabel: "feature/review-status",
    });
    expect(initialWindowStateFromArguments([
      "--gander-window-style=integrated-titlebar",
      "--gander-color-theme=Gander%20Dark",
      "--gander-window-style=anything",
      "--gander-color-theme=%",
    ])).toEqual({
      windowStyle: "native-titlebar",
      colorTheme: "Catppuccin Mocha",
      isDevelopment: false,
      worktreeLabel: null,
    });
  });

  it("routes typed settings calls through their namespaced IPC channels", async () => {
    const invoke = vi.fn(async () => ({ editor: { fontFamily: "monospace", fontSize: 16 } }));
    const api = createGanderApi(invoke, vi.fn());

    await api.getSettings();
    expect(invoke).toHaveBeenLastCalledWith("gander:getSettings");

    const settings = {
      editor: { fontFamily: "Fira Code, monospace", fontSize: 17 },
      window: DEFAULT_APP_SETTINGS.window,
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

  it("requests an image preview only through its explicit IPC channel", async () => {
    const invoke = vi.fn(async () => ({}));
    const api = createGanderApi(invoke, vi.fn());

    await api.imagePreview("acme/atlas", 7, "assets/logo.png");
    expect(invoke).toHaveBeenLastCalledWith("gander:imagePreview", "acme/atlas", 7, "assets/logo.png");
  });

  it("routes local views through separate read-only IPC channels", async () => {
    const invoke = vi.fn(async () => ({}));
    const cleanup = vi.fn();
    const subscribe = vi.fn(() => cleanup);
    const api = createGanderApi(invoke, subscribe);

    await api.listWorktrees("acme/atlas");
    expect(invoke).toHaveBeenLastCalledWith("gander:listWorktrees", "acme/atlas");
    await api.openLocal("acme/atlas", "/tmp/local");
    expect(invoke).toHaveBeenLastCalledWith("gander:openLocal", "acme/atlas", "/tmp/local");
    await api.listLocalFiles("/tmp/local");
    expect(invoke).toHaveBeenLastCalledWith("gander:listLocalFiles", "/tmp/local");
    await api.localFile("/tmp/local", "src/main.ts");
    expect(invoke).toHaveBeenLastCalledWith("gander:localFile", "/tmp/local", "src/main.ts");
    await api.localImagePreview("logo.png");
    expect(invoke).toHaveBeenLastCalledWith("gander:localImagePreview", "logo.png");
    expect(api.onLocalViewChanged(vi.fn())).toBe(cleanup);
    expect(subscribe).toHaveBeenCalledWith("gander:localViewChanged", expect.any(Function));
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

  it("routes zoom calls and forwards main-process zoom changes", async () => {
    const invoke = vi.fn(async () => 0.5);
    const cleanup = vi.fn();
    let subscribed: ((...args: any[]) => void) | undefined;
    const subscribe: Parameters<typeof createGanderApi>[1] = vi.fn((_channel, listener) => {
      subscribed = listener;
      return cleanup;
    });
    const api = createGanderApi(invoke, subscribe);
    const listener = vi.fn();

    await api.getZoomLevel();
    expect(invoke).toHaveBeenLastCalledWith("gander:getZoomLevel");
    await api.setZoomLevel(0.5);
    expect(invoke).toHaveBeenLastCalledWith("gander:setZoomLevel", 0.5);
    expect(api.onZoomChanged(listener)).toBe(cleanup);
    expect(subscribe).toHaveBeenCalledWith("gander:zoomChanged", expect.any(Function));
    subscribed?.(1);
    expect(listener).toHaveBeenCalledWith(1);
  });
});
