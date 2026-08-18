import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, DEFAULT_EDITOR_FONT_FAMILY, parseAppSettings } from "./settings.js";

describe("editor settings", () => {
  it("uses the issue defaults without changing the ordered fallback list", () => {
    expect(DEFAULT_APP_SETTINGS).toEqual({
      editor: {
        fontFamily: "'JetBrainsMono NF', 'FiraCode NF', 'Jetbrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
        fontSize: 16,
      },
    });
    expect(DEFAULT_APP_SETTINGS.editor.fontFamily).toBe(DEFAULT_EDITOR_FONT_FAMILY);
  });

  it("accepts VS Code-compatible fractional font sizes", () => {
    expect(parseAppSettings({ editor: { fontFamily: "Fira Code, monospace", fontSize: 15.5 } }))
      .toEqual({ editor: { fontFamily: "Fira Code, monospace", fontSize: 15.5 } });
  });

  it.each([
    [{ editor: { fontFamily: "", fontSize: 16 } }, "fontFamily"],
    [{ editor: { fontFamily: "monospace", fontSize: 5 } }, "fontSize"],
    [{ editor: { fontFamily: "monospace", fontSize: 101 } }, "fontSize"],
    [{ editor: { fontFamily: "monospace", fontSize: Number.NaN } }, "fontSize"],
  ])("rejects invalid persisted or IPC input", (value, field) => {
    expect(() => parseAppSettings(value)).toThrow(new RegExp(field));
  });
});
