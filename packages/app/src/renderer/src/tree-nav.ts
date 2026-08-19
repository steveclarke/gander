import { reactive } from "vue";
import type { ChangedFile } from "@gander/shared";
import { buildTree, type TreeNode } from "./tree.js";

/**
 * Which directories are collapsed, and whether the keyboard is in the tree.
 *
 * FileTree renders itself recursively, so collapse state held inside the component
 * would live in as many Sets as there are levels. Keyboard navigation needs one answer
 * to "what is visible", so the set lives here and every level reads it. Directory paths
 * are full paths, so one flat set is unambiguous.
 */
export const collapsedDirs = reactive(new Set<string>());

/**
 * True while the file tree holds focus. Collapsing is a structural change, so it stays
 * deliberate: it acts only when the reviewer is in the tree, never while they are reading
 * a diff, where a directory folding away would hide the row they are on.
 */
export const treeFocus = reactive({ active: false });

export function toggleCollapsed(path: string): void {
  if (collapsedDirs.has(path)) collapsedDirs.delete(path);
  else collapsedDirs.add(path);
}

/** Every row the tree draws, in order, with directories inside a collapsed one left out. */
function rows(files: ChangedFile[]): TreeNode[] {
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "file") return [node];
      return collapsedDirs.has(node.path) ? [node] : [node, ...walk(node.children)];
    });
  return walk(buildTree(files));
}

/**
 * Files in the order the tree draws them, skipping anything inside a collapsed directory.
 * Collapsing is how a reviewer sets noise aside, so the cursor walks past a collapsed
 * directory rather than expanding it — what moves is what can be seen.
 */
export function visibleFiles(files: ChangedFile[]): ChangedFile[] {
  return rows(files).flatMap((node) => (node.type === "file" ? [node.file] : []));
}

/** The directory row that owns `path`, or null when the file sits at the root. */
export function directoryOf(files: ChangedFile[], path: string): string | null {
  let found: string | null = null;
  const walk = (nodes: TreeNode[], parent: string | null): void => {
    for (const node of nodes) {
      if (node.type === "file") {
        if (node.file.path === path) found = parent;
      } else if (!collapsedDirs.has(node.path)) {
        walk(node.children, node.path);
      }
    }
  };
  walk(buildTree(files), null);
  return found;
}

/**
 * The first collapsed directory drawn at or after `path` — what `l` expands, so that it
 * undoes the `h` that collapsed the directory the cursor just stepped out of.
 */
export function collapsedDirectoryAfter(files: ChangedFile[], path: string | null): string | null {
  const drawn = rows(files);
  const from = path === null ? 0 : drawn.findIndex((n) => n.type === "file" && n.file.path === path);
  const search = from === -1 ? drawn : drawn.slice(from);
  const hit = search.find((node) => node.type === "dir" && collapsedDirs.has(node.path));
  return hit?.type === "dir" ? hit.path : null;
}

/** Stops at the ends rather than wrapping: the last file should read as "that is all of them". */
export function step(files: ChangedFile[], from: string | null, delta: 1 | -1): string | null {
  const visible = visibleFiles(files);
  if (visible.length === 0) return null;
  const index = visible.findIndex((file) => file.path === from);
  if (index === -1) return (delta === 1 ? visible[0] : visible[visible.length - 1])?.path ?? null;
  return visible[index + delta]?.path ?? null;
}

export function edge(files: ChangedFile[], which: "first" | "last"): string | null {
  const visible = visibleFiles(files);
  return (which === "first" ? visible[0] : visible[visible.length - 1])?.path ?? null;
}

/**
 * The nearest unmarked file in `delta`'s direction. Collapsed directories stay out of it
 * for the same reason the cursor skips them — they are the noise the reviewer set aside.
 * Wraps once, so a pass that started in the middle still reaches the files it skipped past;
 * that backward jump is the point, since it shows the hole the reviewer left.
 */
export function nextUnchecked(files: ChangedFile[], from: string | null, delta: 1 | -1 = 1): string | null {
  const ordered = delta === 1 ? visibleFiles(files) : [...visibleFiles(files)].reverse();
  const start = ordered.findIndex((file) => file.path === from);
  const rotated = start === -1 ? ordered : [...ordered.slice(start + 1), ...ordered.slice(0, start + 1)];
  return rotated.find((file) => "checked" in file && !file.checked)?.path ?? null;
}
