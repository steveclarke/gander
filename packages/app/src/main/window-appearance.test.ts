import { describe, expect, it, vi } from "vitest";
import { themeFor } from "../themes.js";
import { updateNativeWindowTheme, windowAppearance } from "./window-appearance.js";

describe("native window appearance", () => {
  it("integrates macOS window controls into chrome derived from the active theme", () => {
    const appearance = windowAppearance("darwin", "Gander Dark", true, "feature/review-status");

    expect(appearance.windowOptions).toEqual({
      backgroundColor: themeFor("Gander Dark").workbench.background,
      show: false,
      titleBarStyle: "hiddenInset",
    });
    expect(appearance.preloadArguments).toContain("--gander-window-style=integrated-titlebar");
    expect(appearance.preloadArguments).toContain("--gander-color-theme=Gander%20Dark");
    expect(appearance.preloadArguments).toContain("--gander-development");
    expect(appearance.preloadArguments).toContain("--gander-worktree-label=feature%2Freview-status");
    expect(appearance.iconFilename).toBe("icon-dev.png");
  });

  it.each(["linux", "win32"] as const)("leaves the %s system title bar unchanged", (platform) => {
    const appearance = windowAppearance(platform, "Catppuccin Mocha");

    expect(appearance.windowOptions).toEqual({
      backgroundColor: themeFor("Catppuccin Mocha").workbench.background,
    });
    expect(appearance.preloadArguments).toContain("--gander-window-style=native-titlebar");
    expect(appearance.preloadArguments).not.toContain("--gander-development");
    expect(appearance.preloadArguments.some((argument) => argument.startsWith("--gander-worktree-label="))).toBe(false);
    expect(appearance.iconFilename).toBe("icon.png");
  });

  it("updates macOS window backgrounds from the registry during live theme changes", () => {
    const first = { setBackgroundColor: vi.fn() };
    const second = { setBackgroundColor: vi.fn() };

    updateNativeWindowTheme("darwin", [first, second], "Gander Dark");

    expect(first.setBackgroundColor).toHaveBeenCalledWith(themeFor("Gander Dark").workbench.background);
    expect(second.setBackgroundColor).toHaveBeenCalledWith(themeFor("Gander Dark").workbench.background);
  });

  it.each(["linux", "win32"] as const)("does not update %s native window colors", (platform) => {
    const window = { setBackgroundColor: vi.fn() };

    updateNativeWindowTheme(platform, [window], "Gander Dark");

    expect(window.setBackgroundColor).not.toHaveBeenCalled();
  });
});
