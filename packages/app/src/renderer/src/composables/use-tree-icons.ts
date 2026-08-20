import type { FileIconThemeId } from "../../../file-icon-themes.js";
import type { EffectiveTreeTypography } from "../../../settings.js";
import { fileIconFor, folderIconFor, type ResolvedFileIcon } from "../icon-theme.js";
import { languageForPath } from "../languages.js";

/**
 * The icons for a file tree row. Both trees — the review tree and the explorer — draw the
 * same rows from the same theme; only what they do when a row is clicked differs.
 */
export function useTreeIcons(iconTheme: () => FileIconThemeId): {
  fileIcon(path: string): ResolvedFileIcon;
  folderIcon(name: string, expanded: boolean): ResolvedFileIcon;
} {
  return {
    fileIcon(path: string): ResolvedFileIcon {
      // "plaintext" is what the language service says when it has no opinion, and passing
      // it on would claim an identity the file does not have.
      const languageId = languageForPath(path);
      return fileIconFor(iconTheme(), {
        path,
        languageId: languageId === "plaintext" ? undefined : languageId,
      });
    },
    folderIcon(name: string, expanded: boolean): ResolvedFileIcon {
      return folderIconFor(iconTheme(), { name, expanded });
    },
  };
}

/**
 * The tree's own font, applied at the root row so every row inherits it. Only the root:
 * both trees render themselves recursively, and repeating it at every depth would let a
 * nested `em`-based size compound.
 */
export function treeTypographyStyle(
  depth: number,
  typography: EffectiveTreeTypography | undefined,
): { fontFamily: string; fontSize: string } | undefined {
  if (depth !== 0 || typography === undefined) return undefined;
  return { fontFamily: typography.fontFamily, fontSize: `${typography.fontSize}px` };
}
