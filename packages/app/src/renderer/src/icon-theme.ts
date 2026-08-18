import catppuccinMochaThemeJson from "./icon-themes/catppuccin-mocha/theme.json";

export interface FileIconTheme {
  hidesExplorerArrows?: boolean;
  file?: string;
  folder?: string;
  folderExpanded?: string;
  rootFolder?: string;
  rootFolderExpanded?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  languageIds?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  iconDefinitions: Record<string, { iconPath?: string }>;
}

export interface ResolvedFileIcon {
  id: string;
  src: string;
}

export interface FileIconInput {
  path: string;
  languageId?: string;
}

export interface FolderIconInput {
  name: string;
  expanded: boolean;
  root?: boolean;
}

const catppuccinMochaAssets = import.meta.glob(
  "./icon-themes/catppuccin-mocha/icons/*.svg",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

export const CATPPUCCIN_MOCHA_THEME = catppuccinMochaThemeJson as FileIconTheme;

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function normalizedLookup(map: Record<string, string> | undefined, key: string): string | undefined {
  return map?.[key.toLowerCase()];
}

function existingIcon(theme: FileIconTheme, candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (candidate && theme.iconDefinitions[candidate]?.iconPath) return candidate;
  }
  throw new Error("file icon theme has no usable fallback icon");
}

/** Resolve a file icon id using the useful VS Code theme precedence subset. */
export function resolveFileIconId(theme: FileIconTheme, input: FileIconInput): string {
  const name = baseName(input.path).toLowerCase();

  const exact = normalizedLookup(theme.fileNames, name);
  if (exact && theme.iconDefinitions[exact]?.iconPath) return exact;

  const parts = name.split(".");
  for (let index = 1; index < parts.length; index += 1) {
    const compoundExtension = parts.slice(index).join(".");
    const extension = normalizedLookup(theme.fileExtensions, compoundExtension);
    if (extension && theme.iconDefinitions[extension]?.iconPath) return extension;
  }

  const language = input.languageId ? normalizedLookup(theme.languageIds, input.languageId) : undefined;
  return existingIcon(theme, [language, theme.file]);
}

/** Resolve named, expanded, root, and fallback folder icons deterministically. */
export function resolveFolderIconId(theme: FileIconTheme, input: FolderIconInput): string {
  if (input.root) {
    return existingIcon(theme, input.expanded
      ? [theme.rootFolderExpanded, theme.rootFolder, theme.folderExpanded, theme.folder]
      : [theme.rootFolder, theme.folder]);
  }

  const name = baseName(input.name).toLowerCase();
  return existingIcon(theme, input.expanded
    ? [normalizedLookup(theme.folderNamesExpanded, name), normalizedLookup(theme.folderNames, name), theme.folderExpanded, theme.folder]
    : [normalizedLookup(theme.folderNames, name), theme.folder]);
}

function resolveCatppuccinAsset(id: string): ResolvedFileIcon {
  const iconPath = CATPPUCCIN_MOCHA_THEME.iconDefinitions[id]?.iconPath;
  if (!iconPath) throw new Error(`Catppuccin Mocha icon definition ${id} has no path`);
  const key = `./icon-themes/catppuccin-mocha/${iconPath.replace(/^\.\//, "")}`;
  const src = catppuccinMochaAssets[key];
  if (!src) throw new Error(`Catppuccin Mocha asset is missing: ${iconPath}`);
  return { id, src };
}

export function catppuccinFileIcon(input: FileIconInput): ResolvedFileIcon {
  return resolveCatppuccinAsset(resolveFileIconId(CATPPUCCIN_MOCHA_THEME, input));
}

export function catppuccinFolderIcon(input: FolderIconInput): ResolvedFileIcon {
  return resolveCatppuccinAsset(resolveFolderIconId(CATPPUCCIN_MOCHA_THEME, input));
}

export const CATPPUCCIN_MOCHA_SHOWS_EXPLORER_ARROWS = !CATPPUCCIN_MOCHA_THEME.hidesExplorerArrows;
