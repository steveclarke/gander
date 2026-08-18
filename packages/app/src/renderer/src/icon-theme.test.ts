import { describe, expect, it } from "vitest";
import {
  CATPPUCCIN_MOCHA_SHOWS_EXPLORER_ARROWS,
  CATPPUCCIN_MOCHA_THEME,
  catppuccinFileIcon,
  catppuccinFolderIcon,
  resolveFileIconId,
  resolveFolderIconId,
  type FileIconTheme,
} from "./icon-theme.js";

const theme: FileIconTheme = {
  file: "file",
  folder: "folder",
  folderExpanded: "folder-open",
  rootFolder: "root",
  rootFolderExpanded: "root-open",
  fileNames: { "config.test.ts": "exact", gemfile: "gem" },
  fileExtensions: { ts: "typescript", "test.ts": "typescript-test" },
  languageIds: { typescript: "language-typescript", ruby: "ruby" },
  folderNames: { src: "src", config: "config" },
  folderNamesExpanded: { src: "src-open" },
  iconDefinitions: Object.fromEntries([
    "file", "folder", "folder-open", "root", "root-open", "exact", "gem",
    "typescript", "typescript-test", "language-typescript", "ruby", "src", "src-open", "config",
  ].map((id) => [id, { iconPath: `./icons/${id}.svg` }])),
};

describe("file icon theme resolver", () => {
  it("uses exact filenames before compound extensions and language identifiers", () => {
    expect(resolveFileIconId(theme, { path: "src/CONFIG.TEST.TS", languageId: "ruby" })).toBe("exact");
    expect(resolveFileIconId(theme, { path: "src/member.test.ts", languageId: "ruby" })).toBe("typescript-test");
    expect(resolveFileIconId(theme, { path: "src/member.TS", languageId: "ruby" })).toBe("typescript");
    expect(resolveFileIconId(theme, { path: "src/extensionless", languageId: "RUBY" })).toBe("ruby");
  });

  it("falls back to the default file icon for an unknown file and language", () => {
    expect(resolveFileIconId(theme, { path: "src/data.unknown", languageId: "plaintext" })).toBe("file");
  });

  it("resolves named, expanded, root, and unknown folder fallbacks", () => {
    expect(resolveFolderIconId(theme, { name: "SRC", expanded: false })).toBe("src");
    expect(resolveFolderIconId(theme, { name: "services/src", expanded: true })).toBe("src-open");
    expect(resolveFolderIconId(theme, { name: "config", expanded: true })).toBe("config");
    expect(resolveFolderIconId(theme, { name: "unknown", expanded: true })).toBe("folder-open");
    expect(resolveFolderIconId(theme, { name: "repo", expanded: false, root: true })).toBe("root");
    expect(resolveFolderIconId(theme, { name: "repo", expanded: true, root: true })).toBe("root-open");
  });

  it("uses the bundled Catppuccin Mocha theme for representative files and folders", () => {
    expect(catppuccinFileIcon({ path: "Gemfile" }).id).toBe("ruby-gem");
    expect(catppuccinFileIcon({ path: "app/models/member.rb", languageId: "ruby" }).id).toBe("ruby");
    expect(catppuccinFileIcon({ path: "src/App.vue", languageId: "html" }).id).toBe("vue");
    expect(catppuccinFileIcon({ path: "src/main.ts", languageId: "typescript" }).id).toBe("typescript");
    expect(catppuccinFileIcon({ path: "types/index.d.ts", languageId: "typescript" }).id).toBe("typescript-def");
    expect(catppuccinFileIcon({ path: "package.json", languageId: "json" }).id).toBe("package-json");
    expect(catppuccinFileIcon({ path: "README.md", languageId: "markdown" }).id).toBe("readme");
    expect(catppuccinFileIcon({ path: ".editorconfig" }).id).toBe("editorconfig");
    expect(catppuccinFileIcon({ path: "data.unknown" }).id).toBe(CATPPUCCIN_MOCHA_THEME.file);
    expect(catppuccinFolderIcon({ name: "src", expanded: false }).id).toBe("folder_src");
    expect(catppuccinFolderIcon({ name: "src", expanded: true }).id).toBe("folder_src_open");
    expect(catppuccinFolderIcon({ name: "unknown", expanded: false }).id).toBe(CATPPUCCIN_MOCHA_THEME.folder);
    expect(CATPPUCCIN_MOCHA_SHOWS_EXPLORER_ARROWS).toBe(true);
  });
});
