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
    glyphMargin: true,
    automaticLayout: true,
    hideUnchangedRegions: { enabled: true },
    ...editorFontOptions(settings),
  };
}

export function codeEditorOptions(settings: EditorSettings): editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly: true,
    glyphMargin: true,
    automaticLayout: true,
    ...editorFontOptions(settings),
  };
}
