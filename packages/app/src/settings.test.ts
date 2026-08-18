import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_EDITOR_FONT_FAMILY,
  DEFAULT_TREE_FONT_FAMILY,
  effectiveTreeTypography,
  parseAppSettings,
  settingsFromJson,
  settingsToJson,
} from "./settings.js";

describe("application settings", () => {
  it("uses the issue defaults without changing the ordered fallback list", () => {
    expect(DEFAULT_APP_SETTINGS).toEqual({
      editor: {
        fontFamily: "'JetBrainsMono NF', 'FiraCode NF', 'Jetbrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
        fontSize: 16,
      },
      workbench: {
        colorTheme: "Catppuccin Mocha",
        iconTheme: "catppuccin-mocha",
        tree: {
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 13,
          inheritEditorTypography: false,
        },
      },
    });
    expect(DEFAULT_APP_SETTINGS.editor.fontFamily).toBe(DEFAULT_EDITOR_FONT_FAMILY);
    expect(DEFAULT_APP_SETTINGS.workbench.tree.fontFamily).toBe(DEFAULT_TREE_FONT_FAMILY);
  });

  it("accepts VS Code-compatible fractional font sizes", () => {
    expect(parseAppSettings({ editor: { fontFamily: "Fira Code, monospace", fontSize: 15.5 } }))
      .toEqual({
        editor: { fontFamily: "Fira Code, monospace", fontSize: 15.5 },
        workbench: DEFAULT_APP_SETTINGS.workbench,
      });
  });

  it("normalizes Vue settings proxies into data Electron can clone", () => {
    const reactiveSettings = reactive({
      editor: { ...DEFAULT_APP_SETTINGS.editor },
      workbench: { colorTheme: "Gander Dark" as const, iconTheme: "catppuccin-mocha" as const },
    });
    const parsed = parseAppSettings(reactiveSettings);

    expect(() => structuredClone(parsed)).not.toThrow();
    expect(parsed).not.toBe(reactiveSettings);
    expect(parsed.editor).not.toBe(reactiveSettings.editor);
    expect(parsed.workbench).not.toBe(reactiveSettings.workbench);
  });

  it.each([
    [{ editor: { fontFamily: "", fontSize: 16 } }, "fontFamily"],
    [{ editor: { fontFamily: "monospace", fontSize: 5 } }, "fontSize"],
    [{ editor: { fontFamily: "monospace", fontSize: 101 } }, "fontSize"],
    [{ editor: { fontFamily: "monospace", fontSize: Number.NaN } }, "fontSize"],
    [{ editor: { fontFamily: "monospace", fontSize: 16 }, workbench: { colorTheme: "Unknown" } }, "colorTheme"],
    [{ editor: { fontFamily: "monospace", fontSize: 16 }, workbench: { colorTheme: "Catppuccin Mocha", iconTheme: "Unknown" } }, "iconTheme"],
    [{ ...DEFAULT_APP_SETTINGS, workbench: { ...DEFAULT_APP_SETTINGS.workbench, tree: { fontFamily: "", fontSize: 13, inheritEditorTypography: false } } }, "fontFamily"],
    [{ ...DEFAULT_APP_SETTINGS, workbench: { ...DEFAULT_APP_SETTINGS.workbench, tree: { fontFamily: "system-ui", fontSize: 5, inheritEditorTypography: false } } }, "fontSize"],
    [{ ...DEFAULT_APP_SETTINGS, workbench: { ...DEFAULT_APP_SETTINGS.workbench, tree: { fontFamily: "system-ui", fontSize: 13, inheritEditorTypography: "yes" } } }, "inheritEditorTypography"],
  ])("rejects invalid persisted or IPC input", (value, field) => {
    expect(() => parseAppSettings(value)).toThrow(new RegExp(field));
  });

  it("round-trips the public VS Code-style JSON keys without exposing private config", () => {
    const source = settingsToJson(DEFAULT_APP_SETTINGS);
    expect(JSON.parse(source)).toEqual({
      "editor.fontFamily": DEFAULT_EDITOR_FONT_FAMILY,
      "editor.fontSize": 16,
      "workbench.colorTheme": "Catppuccin Mocha",
      "workbench.iconTheme": "catppuccin-mocha",
      "workbench.tree.fontFamily": DEFAULT_TREE_FONT_FAMILY,
      "workbench.tree.fontSize": 13,
      "workbench.tree.inheritEditorTypography": false,
    });
    expect(source).not.toContain("serviceToken");
    expect(settingsFromJson(source, DEFAULT_APP_SETTINGS)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("preserves future app settings when applying the current public JSON", () => {
    const current = { ...DEFAULT_APP_SETTINGS, futureSetting: true };
    expect(settingsFromJson(JSON.stringify({
      "editor.fontFamily": "Consolas, monospace",
      "editor.fontSize": 18,
      "workbench.colorTheme": "Gander Dark",
      "workbench.iconTheme": "catppuccin-mocha",
      "workbench.tree.fontFamily": "system-ui, sans-serif",
      "workbench.tree.fontSize": 14,
      "workbench.tree.inheritEditorTypography": true,
    }), current)).toEqual({
      futureSetting: true,
      editor: { fontFamily: "Consolas, monospace", fontSize: 18 },
      workbench: {
        colorTheme: "Gander Dark",
        iconTheme: "catppuccin-mocha",
        tree: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          inheritEditorTypography: true,
        },
      },
    });
  });

  it.each([
    ["{", /Invalid settings JSON/],
    [JSON.stringify({ "editor.fontFamily": "monospace" }), /editor\.fontSize/],
    [JSON.stringify({ "editor.fontFamily": "monospace", "editor.fontSize": 16, "workbench.colorTheme": "Unknown", "workbench.iconTheme": "catppuccin-mocha", "workbench.tree.fontFamily": DEFAULT_TREE_FONT_FAMILY, "workbench.tree.fontSize": 13, "workbench.tree.inheritEditorTypography": false }), /workbench\.colorTheme/],
    [JSON.stringify({ "editor.fontFamily": "monospace", "editor.fontSize": 16, "workbench.colorTheme": "Catppuccin Mocha", "workbench.iconTheme": "Unknown", "workbench.tree.fontFamily": DEFAULT_TREE_FONT_FAMILY, "workbench.tree.fontSize": 13, "workbench.tree.inheritEditorTypography": false }), /workbench\.iconTheme/],
    [JSON.stringify({ "editor.fontFamily": "monospace", "editor.fontSize": 16, "workbench.colorTheme": "Catppuccin Mocha", "workbench.iconTheme": "catppuccin-mocha", "workbench.tree.fontFamily": DEFAULT_TREE_FONT_FAMILY, "workbench.tree.fontSize": 13, "workbench.tree.inheritEditorTypography": false, serviceToken: "nope" }), /Unrecognized key/],
  ])("rejects invalid or non-public settings JSON", (source, message) => {
    expect(() => settingsFromJson(source, DEFAULT_APP_SETTINGS)).toThrow(message);
  });

  it("adds the file icon default to settings written by the color-theme release", () => {
    expect(parseAppSettings({
      editor: { fontFamily: "Consolas, monospace", fontSize: 18 },
      workbench: { colorTheme: "Gander Dark" },
    })).toEqual({
      editor: { fontFamily: "Consolas, monospace", fontSize: 18 },
      workbench: {
        colorTheme: "Gander Dark",
        iconTheme: "catppuccin-mocha",
        tree: DEFAULT_APP_SETTINGS.workbench.tree,
      },
    });
  });

  it("derives effective tree typography in one place for independent and inherited settings", () => {
    const independent = {
      ...DEFAULT_APP_SETTINGS,
      editor: { fontFamily: "Editor Mono", fontSize: 18 },
      workbench: {
        ...DEFAULT_APP_SETTINGS.workbench,
        tree: { fontFamily: "Tree UI", fontSize: 14, inheritEditorTypography: false },
      },
    };
    expect(effectiveTreeTypography(independent)).toEqual({ fontFamily: "Tree UI", fontSize: 14 });
    expect(effectiveTreeTypography({
      ...independent,
      workbench: {
        ...independent.workbench,
        tree: { ...independent.workbench.tree, inheritEditorTypography: true },
      },
    })).toEqual({ fontFamily: "Editor Mono", fontSize: 18 });
  });
});
