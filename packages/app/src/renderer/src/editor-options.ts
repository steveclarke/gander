import type { editor } from "monaco-editor";
import type { EditorSettings } from "../../settings.js";

export function editorFontOptions(settings: EditorSettings): { fontFamily: string; fontSize: number } {
  return {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
  };
}

export function diffEditorOptions(settings: EditorSettings): editor.IStandaloneDiffEditorConstructionOptions {
  return {
    renderSideBySide: false,
    readOnly: true,
    automaticLayout: true,
    hideUnchangedRegions: { enabled: true },
    theme: "vs-dark",
    ...editorFontOptions(settings),
  };
}

export function codeEditorOptions(settings: EditorSettings): editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly: true,
    automaticLayout: true,
    theme: "vs-dark",
    ...editorFontOptions(settings),
  };
}
