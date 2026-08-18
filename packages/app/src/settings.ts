import { z } from "zod";
import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from "./themes.js";
import {
  DEFAULT_FILE_ICON_THEME_ID,
  FILE_ICON_THEME_IDS,
  type FileIconThemeId,
} from "./file-icon-themes.js";
import { DEFAULT_ZOOM_LEVEL, ZoomLevelSchema } from "./zoom.js";

export const DEFAULT_EDITOR_FONT_FAMILY =
  "'JetBrainsMono NF', 'FiraCode NF', 'Jetbrains Mono', 'Fira Code', Consolas, 'Courier New', monospace";
export const DEFAULT_TREE_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const EditorSettingsSchema = z.object({
  fontFamily: z.string().trim().min(1),
  // Match Monaco/VS Code: font sizes are numbers (including fractional values)
  // clamped to the editor's supported 6–100 pixel range.
  fontSize: z.number().finite().min(6).max(100),
}).strict();

export const ThemeIdSchema = z.enum(THEME_IDS);
export const FileIconThemeIdSchema = z.enum(FILE_ICON_THEME_IDS);

export const TreeTypographySettingsSchema = z.object({
  fontFamily: z.string().trim().min(1),
  fontSize: z.number().finite().min(6).max(100),
  inheritEditorTypography: z.boolean(),
}).strict();

export const WindowSettingsSchema = z.object({
  zoomLevel: ZoomLevelSchema,
}).strict();

export const DEFAULT_WINDOW_SETTINGS: Readonly<WindowSettings> = Object.freeze({
  zoomLevel: DEFAULT_ZOOM_LEVEL,
});

export const DEFAULT_TREE_TYPOGRAPHY_SETTINGS: Readonly<TreeTypographySettings> = Object.freeze({
  fontFamily: DEFAULT_TREE_FONT_FAMILY,
  fontSize: 13,
  inheritEditorTypography: false,
});

export const WorkbenchSettingsSchema = z.object({
  colorTheme: ThemeIdSchema,
  iconTheme: FileIconThemeIdSchema,
  tree: TreeTypographySettingsSchema,
}).strict();

export const DEFAULT_WORKBENCH_SETTINGS: Readonly<WorkbenchSettings> = Object.freeze({
  colorTheme: DEFAULT_THEME_ID,
  iconTheme: DEFAULT_FILE_ICON_THEME_ID,
  tree: DEFAULT_TREE_TYPOGRAPHY_SETTINGS,
});

export const AppSettingsSchema = z.object({
  editor: EditorSettingsSchema,
  window: WindowSettingsSchema,
  workbench: WorkbenchSettingsSchema,
}).strict();

export const SettingsJsonSchema = z.object({
  "editor.fontFamily": EditorSettingsSchema.shape.fontFamily,
  "editor.fontSize": EditorSettingsSchema.shape.fontSize,
  "window.zoomLevel": ZoomLevelSchema,
  "workbench.colorTheme": ThemeIdSchema,
  "workbench.iconTheme": FileIconThemeIdSchema,
  "workbench.tree.fontFamily": TreeTypographySettingsSchema.shape.fontFamily,
  "workbench.tree.fontSize": TreeTypographySettingsSchema.shape.fontSize,
  "workbench.tree.inheritEditorTypography": TreeTypographySettingsSchema.shape.inheritEditorTypography,
}).strict();

export type EditorSettings = z.infer<typeof EditorSettingsSchema>;
export type WindowSettings = z.infer<typeof WindowSettingsSchema>;
export type TreeTypographySettings = z.infer<typeof TreeTypographySettingsSchema>;
export type EffectiveTreeTypography = Pick<TreeTypographySettings, "fontFamily" | "fontSize">;
export type WorkbenchSettings = z.infer<typeof WorkbenchSettingsSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type SettingsJson = z.infer<typeof SettingsJsonSchema>;
export type { ThemeId };
export type { FileIconThemeId };

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  editor: Object.freeze({
    fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    fontSize: 16,
  }),
  window: DEFAULT_WINDOW_SETTINGS,
  workbench: DEFAULT_WORKBENCH_SETTINGS,
});

export function parseAppSettings(value: unknown): AppSettings {
  const parsed = AppSettingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join(", ");
  throw new Error(`Invalid application settings: ${details}`);
}

export function settingsToJson(settings: AppSettings): string {
  const publicSettings: SettingsJson = {
    "editor.fontFamily": settings.editor.fontFamily,
    "editor.fontSize": settings.editor.fontSize,
    "window.zoomLevel": settings.window.zoomLevel,
    "workbench.colorTheme": settings.workbench.colorTheme,
    "workbench.iconTheme": settings.workbench.iconTheme,
    "workbench.tree.fontFamily": settings.workbench.tree.fontFamily,
    "workbench.tree.fontSize": settings.workbench.tree.fontSize,
    "workbench.tree.inheritEditorTypography": settings.workbench.tree.inheritEditorTypography,
  };
  return JSON.stringify(publicSettings, null, 2);
}

export function settingsFromJson(source: string): AppSettings {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid settings JSON: ${(error as Error).message}`);
  }

  const parsed = SettingsJsonSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`)
      .join(", ");
    throw new Error(`Invalid settings JSON: ${details}`);
  }

  return {
    editor: {
      fontFamily: parsed.data["editor.fontFamily"],
      fontSize: parsed.data["editor.fontSize"],
    },
    window: {
      zoomLevel: parsed.data["window.zoomLevel"],
    },
    workbench: {
      colorTheme: parsed.data["workbench.colorTheme"],
      iconTheme: parsed.data["workbench.iconTheme"],
      tree: {
        fontFamily: parsed.data["workbench.tree.fontFamily"],
        fontSize: parsed.data["workbench.tree.fontSize"],
        inheritEditorTypography: parsed.data["workbench.tree.inheritEditorTypography"],
      },
    },
  };
}

export function effectiveTreeTypography(settings: AppSettings): EffectiveTreeTypography {
  if (settings.workbench.tree.inheritEditorTypography) {
    return {
      fontFamily: settings.editor.fontFamily,
      fontSize: settings.editor.fontSize,
    };
  }
  return {
    fontFamily: settings.workbench.tree.fontFamily,
    fontSize: settings.workbench.tree.fontSize,
  };
}
