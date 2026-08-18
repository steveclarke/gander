// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ID, THEME_REGISTRY, themeFor } from "../../themes.js";
import { applyAppTheme } from "./theme-runtime.js";

describe("theme runtime", () => {
  it("ships Catppuccin Mocha as the complete, attributed default", () => {
    const theme = themeFor(DEFAULT_THEME_ID);
    expect(theme.id).toBe("Catppuccin Mocha");
    expect(theme.source).toBe("Catppuccin for VS Code 3.19.0");
    expect(Object.keys(theme.workbench)).toHaveLength(26);
    expect(Object.values(theme.workbench).every(Boolean)).toBe(true);
    expect(theme.monaco.colors["editor.background"]).toBe("#1e1e2e");
    expect(theme.monaco.colors["diffEditor.insertedTextBackground"]).toBe("#a6e3a133");
  });

  it("applies Vue tokens and registers/selects Monaco from the same registry entry", () => {
    const root = document.createElement("html");
    const monacoThemeApi = { defineTheme: vi.fn(), setTheme: vi.fn() };

    applyAppTheme("Catppuccin Mocha", root, monacoThemeApi);

    const theme = THEME_REGISTRY["Catppuccin Mocha"];
    expect(root.dataset.colorTheme).toBe(theme.id);
    expect(root.style.getPropertyValue("--workbench-background")).toBe(theme.workbench.background);
    expect(root.style.getPropertyValue("--input-background")).toBe(theme.workbench.inputBackground);
    expect(root.style.getPropertyValue("--danger-background")).toBe(theme.workbench.dangerBackground);
    expect(monacoThemeApi.defineTheme).toHaveBeenCalledWith(theme.monacoName, theme.monaco);
    expect(monacoThemeApi.setTheme).toHaveBeenCalledWith(theme.monacoName);

    applyAppTheme("Gander Dark", root, monacoThemeApi);
    expect(root.dataset.colorTheme).toBe("Gander Dark");
    expect(root.style.getPropertyValue("--workbench-background")).toBe("#16181d");
    expect(monacoThemeApi.setTheme).toHaveBeenLastCalledWith("gander-dark");
  });
});
