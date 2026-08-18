import { z } from "zod";

export const DEFAULT_EDITOR_FONT_FAMILY =
  "'JetBrainsMono NF', 'FiraCode NF', 'Jetbrains Mono', 'Fira Code', Consolas, 'Courier New', monospace";

export const EditorSettingsSchema = z.object({
  fontFamily: z.string().trim().min(1),
  // Match Monaco/VS Code: font sizes are numbers (including fractional values)
  // clamped to the editor's supported 6–100 pixel range.
  fontSize: z.number().finite().min(6).max(100),
});

export const AppSettingsSchema = z.object({
  editor: EditorSettingsSchema,
}).passthrough();

export const SettingsJsonSchema = z.object({
  "editor.fontFamily": EditorSettingsSchema.shape.fontFamily,
  "editor.fontSize": EditorSettingsSchema.shape.fontSize,
}).strict();

export type EditorSettings = z.infer<typeof EditorSettingsSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type SettingsJson = z.infer<typeof SettingsJsonSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  editor: Object.freeze({
    fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    fontSize: 16,
  }),
});

export function parseAppSettings(value: unknown): AppSettings {
  const parsed = AppSettingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join(", ");
  throw new Error(`Invalid editor settings: ${details}`);
}

export function settingsToJson(settings: AppSettings): string {
  const publicSettings: SettingsJson = {
    "editor.fontFamily": settings.editor.fontFamily,
    "editor.fontSize": settings.editor.fontSize,
  };
  return JSON.stringify(publicSettings, null, 2);
}

export function settingsFromJson(source: string, current: AppSettings): AppSettings {
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
    ...current,
    editor: {
      fontFamily: parsed.data["editor.fontFamily"],
      fontSize: parsed.data["editor.fontSize"],
    },
  };
}
