import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AppUpdater } from "electron-updater";
import { createUpdateController, supportsInPlaceUpdates } from "./updates.js";

function setup() {
  const events = new EventEmitter();
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => null),
    on: events.on.bind(events),
    quitAndInstall: vi.fn(),
  } as unknown as Pick<AppUpdater, "autoDownload" | "autoInstallOnAppQuit" | "checkForUpdates" | "on" | "quitAndInstall">;
  const prompts = {
    currentVersion: vi.fn(() => "1.2.3"),
    showUpToDate: vi.fn(async () => undefined),
    confirmRestart: vi.fn(async () => false),
    showError: vi.fn(),
  };
  const controller = createUpdateController(updater, prompts);
  return { controller, events, prompts, updater };
}

describe("in-place update support", () => {
  it("runs only in packaged macOS and AppImage builds", () => {
    expect(supportsInPlaceUpdates(false, "darwin", undefined, true)).toBe(false);
    expect(supportsInPlaceUpdates(false, "linux", "/tmp/Gander.AppImage", true)).toBe(false);
    expect(supportsInPlaceUpdates(true, "darwin", undefined, false)).toBe(false);
    expect(supportsInPlaceUpdates(true, "darwin", undefined, true)).toBe(true);
    expect(supportsInPlaceUpdates(true, "linux", undefined, true)).toBe(false);
    expect(supportsInPlaceUpdates(true, "linux", "/tmp/Gander.AppImage", true)).toBe(true);
    expect(supportsInPlaceUpdates(true, "win32", undefined, true)).toBe(false);
  });

  it("downloads updates but never installs them silently on quit", () => {
    const { updater } = setup();

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("keeps the startup check quiet when the current version is latest", async () => {
    const { controller, events, prompts, updater } = setup();

    controller.checkAtStartup();
    events.emit("update-not-available", { version: "1.2.3" });
    await Promise.resolve();

    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(prompts.showUpToDate).not.toHaveBeenCalled();
  });

  it("confirms a manual check when the current version is latest", async () => {
    const { controller, events, prompts } = setup();

    controller.checkManually();
    events.emit("update-not-available", { version: "1.2.3" });
    await Promise.resolve();

    expect(prompts.showUpToDate).toHaveBeenCalledWith("1.2.3");
  });

  it("restarts only after the user consents to install a downloaded update", async () => {
    const { events, prompts, updater } = setup();
    prompts.confirmRestart.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    events.emit("update-downloaded", { version: "1.3.0" });
    await Promise.resolve();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    events.emit("update-downloaded", { version: "1.3.0" });
    await Promise.resolve();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("surfaces updater failures once even when the event and promise report the same error", async () => {
    const { controller, events, prompts, updater } = setup();
    const failure = new Error("latest-mac.yml returned 503");
    updater.checkForUpdates = vi.fn(async () => { throw failure; });

    controller.checkManually();
    events.emit("error", failure);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prompts.showError).toHaveBeenCalledOnce();
    expect(prompts.showError).toHaveBeenCalledWith("latest-mac.yml returned 503");
  });
});
