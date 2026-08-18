import { describe, expect, it } from "vitest";
import { codeEditorOptions, diffEditorOptions, editorFontOptions } from "./editor-options.js";
import { DEFAULT_APP_SETTINGS } from "../../settings.js";

describe("Monaco editor options", () => {
  it("passes the complete ordered font fallback string and font size to Monaco", () => {
    expect(editorFontOptions(DEFAULT_APP_SETTINGS.editor)).toEqual({
      fontFamily: "'JetBrainsMono NF', 'FiraCode NF', 'Jetbrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      fontSize: 16,
    });
  });

  it("passes saved settings through unchanged", () => {
    expect(editorFontOptions({ fontFamily: "A, B, monospace", fontSize: 19.5 }))
      .toEqual({ fontFamily: "A, B, monospace", fontSize: 19.5 });
  });

  it("applies font settings to both Monaco diff and full-file editor options", () => {
    const settings = { fontFamily: "A, B, monospace", fontSize: 19.5 };
    expect(diffEditorOptions(settings)).toMatchObject(settings);
    expect(codeEditorOptions(settings)).toMatchObject(settings);
  });
});
