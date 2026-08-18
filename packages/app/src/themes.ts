import type { editor } from "monaco-editor";

export const THEME_IDS = ["Catppuccin Mocha", "Gander Dark"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface WorkbenchThemeTokens {
  background: string;
  panelBackground: string;
  secondaryPanelBackground: string;
  elevatedBackground: string;
  inputBackground: string;
  badgeBackground: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  faintForeground: string;
  accent: string;
  accentForeground: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  hoverBackground: string;
  selectionBackground: string;
  focusRing: string;
  overlay: string;
  shadow: string;
  successBackground: string;
  dangerBackground: string;
  warningBackground: string;
  addedGutterBackground: string;
  deletedGutterBackground: string;
}

export interface GanderTheme {
  id: ThemeId;
  label: string;
  source: string;
  workbench: WorkbenchThemeTokens;
  monacoName: string;
  monaco: editor.IStandaloneThemeData;
}

const catppuccinMochaWorkbench = {
  background: "#1e1e2e",
  panelBackground: "#181825",
  secondaryPanelBackground: "#11111b",
  elevatedBackground: "#313244",
  inputBackground: "#313244",
  badgeBackground: "#45475a",
  border: "#585b70",
  foreground: "#cdd6f4",
  mutedForeground: "#a6adc8",
  faintForeground: "#9399b2",
  accent: "#cba6f7",
  accentForeground: "#11111b",
  success: "#a6e3a1",
  danger: "#f38ba8",
  warning: "#fab387",
  info: "#89b4fa",
  hoverBackground: "#31324480",
  selectionBackground: "#cba6f733",
  focusRing: "#cba6f766",
  overlay: "#11111bbf",
  shadow: "#11111bcc",
  successBackground: "#a6e3a126",
  dangerBackground: "#f38ba826",
  warningBackground: "#fab3871f",
  addedGutterBackground: "#a6e3a140",
  deletedGutterBackground: "#f38ba840",
} satisfies WorkbenchThemeTokens;

// Adapted from Catppuccin for VS Code 3.19.0's generated Mocha theme. The
// bundled notice records the source and license; Gander never reads VS Code at runtime.
const catppuccinMochaMonaco: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "cdd6f4" },
    { token: "comment", foreground: "9399b2", fontStyle: "italic" },
    { token: "string", foreground: "a6e3a1" },
    { token: "string.escape", foreground: "f5c2e7" },
    { token: "number", foreground: "fab387" },
    { token: "keyword", foreground: "cba6f7" },
    { token: "operator", foreground: "94e2d5" },
    { token: "delimiter", foreground: "9399b2" },
    { token: "type", foreground: "f9e2af" },
    { token: "type.identifier", foreground: "f9e2af" },
    { token: "identifier", foreground: "cdd6f4" },
    { token: "variable", foreground: "cdd6f4" },
    { token: "variable.predefined", foreground: "f38ba8" },
    { token: "function", foreground: "89b4fa" },
    { token: "tag", foreground: "cba6f7" },
    { token: "attribute.name", foreground: "89b4fa" },
    { token: "attribute.value", foreground: "a6e3a1" },
    { token: "constant", foreground: "fab387" },
    { token: "regexp", foreground: "f5c2e7" },
    { token: "annotation", foreground: "fab387" },
  ],
  colors: {
    "editor.background": "#1e1e2e",
    "editor.foreground": "#cdd6f4",
    "editorCursor.foreground": "#f5e0dc",
    "editorLineNumber.foreground": "#7f849c",
    "editorLineNumber.activeForeground": "#cba6f7",
    "editor.selectionBackground": "#9399b240",
    "editor.selectionHighlightBackground": "#9399b233",
    "editor.lineHighlightBackground": "#cdd6f412",
    "editor.findMatchBackground": "#5e3f53",
    "editor.findMatchHighlightBackground": "#3e5767",
    "editor.foldBackground": "#89dceb40",
    "editorIndentGuide.background1": "#45475a",
    "editorIndentGuide.activeBackground1": "#585b70",
    "editorWhitespace.foreground": "#9399b266",
    "editorGutter.background": "#1e1e2e",
    "editorGutter.addedBackground": "#a6e3a1",
    "editorGutter.deletedBackground": "#f38ba8",
    "editorGutter.modifiedBackground": "#f9e2af",
    "editorOverviewRuler.border": "#cdd6f412",
    "editorWidget.background": "#181825",
    "editorWidget.foreground": "#cdd6f4",
    "editorWidget.border": "#585b70",
    "input.background": "#313244",
    "input.foreground": "#cdd6f4",
    "input.placeholderForeground": "#cdd6f473",
    "focusBorder": "#cba6f7",
    "scrollbar.shadow": "#11111b",
    "scrollbarSlider.background": "#585b7080",
    "scrollbarSlider.hoverBackground": "#6c7086",
    "scrollbarSlider.activeBackground": "#31324466",
    "diffEditor.border": "#585b70",
    "diffEditor.insertedTextBackground": "#a6e3a133",
    "diffEditor.removedTextBackground": "#f38ba833",
    "diffEditor.insertedLineBackground": "#a6e3a126",
    "diffEditor.removedLineBackground": "#f38ba826",
    "diffEditor.diagonalFill": "#585b7099",
  },
};

const ganderDarkWorkbench = {
  background: "#16181d",
  panelBackground: "#1c1f26",
  secondaryPanelBackground: "#191c22",
  elevatedBackground: "#2c3340",
  inputBackground: "#14161b",
  badgeBackground: "#262b34",
  border: "#2a2e37",
  foreground: "#d7dae0",
  mutedForeground: "#8b919d",
  faintForeground: "#8b919d",
  accent: "#4d9fec",
  accentForeground: "#0d1117",
  success: "#3fb950",
  danger: "#f85149",
  warning: "#d29922",
  info: "#bc8cff",
  hoverBackground: "#232833",
  selectionBackground: "#4d9fec24",
  focusRing: "#4d9fec29",
  overlay: "#00000073",
  shadow: "#00000080",
  successBackground: "#3fb95021",
  dangerBackground: "#f851491f",
  warningBackground: "#d2992214",
  addedGutterBackground: "#3fb95040",
  deletedGutterBackground: "#f8514940",
} satisfies WorkbenchThemeTokens;

const ganderDarkMonaco: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#14161b",
    "editor.foreground": "#d7dae0",
    "diffEditor.insertedLineBackground": "#3fb95021",
    "diffEditor.removedLineBackground": "#f851491f",
    "diffEditor.insertedTextBackground": "#3fb95040",
    "diffEditor.removedTextBackground": "#f8514940",
  },
};

export const THEME_REGISTRY: Readonly<Record<ThemeId, GanderTheme>> = Object.freeze({
  "Catppuccin Mocha": Object.freeze({
    id: "Catppuccin Mocha",
    label: "Catppuccin Mocha",
    source: "Catppuccin for VS Code 3.19.0",
    workbench: Object.freeze(catppuccinMochaWorkbench),
    monacoName: "gander-catppuccin-mocha",
    monaco: Object.freeze(catppuccinMochaMonaco),
  }),
  "Gander Dark": Object.freeze({
    id: "Gander Dark",
    label: "Gander Dark",
    source: "Gander",
    workbench: Object.freeze(ganderDarkWorkbench),
    monacoName: "gander-dark",
    monaco: Object.freeze(ganderDarkMonaco),
  }),
});

export const DEFAULT_THEME_ID: ThemeId = "Catppuccin Mocha";

export function themeFor(id: ThemeId): GanderTheme {
  return THEME_REGISTRY[id];
}
