const EXT_TO_LANG: Record<string, string> = {
  rb: "ruby", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  vue: "html", html: "html", css: "css", scss: "scss", json: "json", md: "markdown",
  py: "python", sh: "shell", bash: "shell", go: "go", rs: "rust", yml: "yaml", yaml: "yaml",
  sql: "sql", xml: "xml", toml: "ini",
};

/** Maps a file path's extension to a Monaco language id; unknown extensions fall back to "plaintext". */
export function languageForPath(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  return EXT_TO_LANG[base.slice(dot + 1).toLowerCase()] ?? "plaintext";
}
