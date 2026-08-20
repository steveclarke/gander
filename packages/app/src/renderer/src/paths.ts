/**
 * Repository paths are always slash-separated — they come from git, not from the local
 * filesystem — so these never touch `path.sep`.
 */

/** The last segment: `src/main/git.ts` → `git.ts`. */
export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** The containing directory, `""` at the root: `src/main/git.ts` → `src/main`. */
export function parentDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

/**
 * The directory as it is shown in front of a filename, trailing slash included, and empty
 * at the root: `src/main/git.ts` → `src/main/`.
 */
export function directoryPrefix(path: string): string {
  const directory = parentDirectory(path);
  return directory === "" ? "" : `${directory}/`;
}
