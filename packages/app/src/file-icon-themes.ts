export const FILE_ICON_THEME_IDS = ["catppuccin-mocha"] as const;

export type FileIconThemeId = (typeof FILE_ICON_THEME_IDS)[number];

export interface FileIconThemeMetadata {
  id: FileIconThemeId;
  label: string;
  source: string;
}

export const DEFAULT_FILE_ICON_THEME_ID: FileIconThemeId = "catppuccin-mocha";

const FILE_ICON_THEMES: Record<FileIconThemeId, FileIconThemeMetadata> = {
  "catppuccin-mocha": {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    source: "Catppuccin Icons for VS Code 1.26.0",
  },
};

export function fileIconThemeFor(id: FileIconThemeId): FileIconThemeMetadata {
  return FILE_ICON_THEMES[id];
}
