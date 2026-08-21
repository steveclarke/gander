import { reactive, ref, shallowRef } from "vue";
import type { ChangedFile } from "@gander/shared";
import { buildTree, type TreeNode } from "./tree.js";

/**
 * Where the keyboard is in the file tree, and which directories are collapsed.
 *
 * FileTree renders itself recursively, so collapse state held inside the component would
 * live in as many Sets as there are levels. Keyboard movement needs one answer to what is
 * visible, so the set lives here and every level reads it. Directory paths are full paths,
 * so one flat set is unambiguous.
 */
export const collapsedDirs = reactive(new Set<string>());

/** Whether the review tree omits files the reviewer has already checked. */
export const remainingOnly = shallowRef(false);

/**
 * The row the keyboard is on, which is a directory as often as a file. It is separate from
 * the reviewer's selected file because a directory has nothing to show in the diff: passing
 * over one leaves the reader looking at the file they were already reading.
 */
export const cursor = ref<string | null>(null);

export function toggleCollapsed(path: string): void {
  if (collapsedDirs.has(path)) collapsedDirs.delete(path);
  else collapsedDirs.add(path);
}

/** Makes a file opened outside the tree visible and puts the keyboard cursor on it. */
export function revealReviewFile(path: string): void {
  remainingOnly.value = false;
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    collapsedDirs.delete(parts.slice(0, index).join("/"));
  }
  cursor.value = path;
}

/** Files currently included in the review tree. Local files have no review state. */
export function reviewTreeFiles(files: ChangedFile[]): ChangedFile[] {
  if (!remainingOnly.value) return files;
  return files.filter((file) => !("checked" in file) || !file.checked);
}

function directoryPaths(files: ChangedFile[]): string[] {
  const walk = (nodes: TreeNode[]): string[] => nodes.flatMap((node) =>
    node.type === "dir" ? [node.path, ...walk(node.children)] : [],
  );
  return walk(buildTree(files));
}

function fullyReviewedDirectoryPaths(files: ChangedFile[]): string[] {
  const paths: string[] = [];
  const reviewed = (node: TreeNode): boolean => {
    if (node.type === "file") return "checked" in node.file && node.file.checked === true;

    const childrenReviewed = node.children.map(reviewed).every(Boolean);
    if (childrenReviewed) paths.push(node.path);
    return childrenReviewed;
  };

  for (const node of buildTree(files)) reviewed(node);
  return paths;
}

export function hasFullyReviewedDirectories(files: ChangedFile[]): boolean {
  return fullyReviewedDirectoryPaths(files).length > 0;
}

export function collapseFullyReviewedDirectories(files: ChangedFile[]): void {
  for (const path of fullyReviewedDirectoryPaths(files)) collapsedDirs.add(path);
}

export function allDirectoriesCollapsed(files: ChangedFile[]): boolean {
  const paths = directoryPaths(files);
  return paths.length > 0 && paths.every((path) => collapsedDirs.has(path));
}

export function toggleAllDirectories(files: ChangedFile[]): void {
  if (allDirectoriesCollapsed(files)) {
    collapsedDirs.clear();
    return;
  }

  collapsedDirs.clear();
  for (const path of directoryPaths(files)) collapsedDirs.add(path);
}

/** Every row the tree draws, in order, with the contents of a collapsed directory left out. */
export function rows(files: ChangedFile[]): TreeNode[] {
  const walk = (nodes: TreeNode[]): TreeNode[] =>
    nodes.flatMap((node) => {
      if (node.type === "file") return [node];
      return collapsedDirs.has(node.path) ? [node] : [node, ...walk(node.children)];
    });
  return walk(buildTree(reviewTreeFiles(files)));
}

export function pathOf(node: TreeNode): string {
  return node.type === "dir" ? node.path : node.file.path;
}

export function rowAt(files: ChangedFile[], path: string | null): TreeNode | null {
  if (path === null) return null;
  return rows(files).find((node) => pathOf(node) === path) ?? null;
}

/** Files in draw order, skipping anything inside a collapsed directory. */
export function visibleFiles(files: ChangedFile[]): ChangedFile[] {
  return rows(files).flatMap((node) => (node.type === "file" ? [node.file] : []));
}

/** The directory row that owns `path`, or null when the row sits at the top level. */
export function parentOf(files: ChangedFile[], path: string): string | null {
  let found: string | null = null;
  const walk = (nodes: TreeNode[], parent: string | null): void => {
    for (const node of nodes) {
      if (pathOf(node) === path) { found = parent; return; }
      if (node.type === "dir" && !collapsedDirs.has(node.path)) walk(node.children, node.path);
    }
  };
  walk(buildTree(files), null);
  return found;
}

/** Stops at the ends rather than wrapping: the last row should read as "that is all of them". */
export function step(files: ChangedFile[], from: string | null, delta: 1 | -1): string | null {
  const drawn = rows(files);
  if (drawn.length === 0) return null;
  const index = drawn.findIndex((node) => pathOf(node) === from);
  if (index === -1) {
    const fallback = delta === 1 ? drawn[0] : drawn[drawn.length - 1];
    return fallback === undefined ? null : pathOf(fallback);
  }
  const next = drawn[index + delta];
  return next === undefined ? null : pathOf(next);
}

export function edge(files: ChangedFile[], which: "first" | "last"): string | null {
  const drawn = rows(files);
  const node = which === "first" ? drawn[0] : drawn[drawn.length - 1];
  return node === undefined ? null : pathOf(node);
}

/** Every file beneath a row: the row itself when it is a file, the whole subtree when not. */
export function filesAt(files: ChangedFile[], path: string | null): ChangedFile[] {
  const node = rowAt(files, path);
  if (node === null) return [];
  if (node.type === "file") return [node.file];
  // Reads the built tree rather than the drawn rows, so marking a collapsed directory still
  // covers what it contains — folding it away is about reading, not about scope.
  const collect = (n: TreeNode): ChangedFile[] =>
    n.type === "file" ? [n.file] : n.children.flatMap(collect);
  return collect(node);
}

/**
 * The nearest row in `delta`'s direction holding unmarked work. Wraps once, so a pass that
 * started in the middle still reaches what it skipped past; that backward jump is the
 * point, since it shows the hole the reviewer left.
 */
export function nextUnmarked(files: ChangedFile[], from: string | null, delta: 1 | -1 = 1): string | null {
  const drawn = delta === 1 ? rows(files) : [...rows(files)].reverse();
  const start = drawn.findIndex((node) => pathOf(node) === from);
  const rotated = start === -1 ? drawn : [...drawn.slice(start + 1), ...drawn.slice(0, start + 1)];
  const hit = rotated.find((node) => {
    const under = filesAt(files, pathOf(node));
    return under.some((file) => "checked" in file && !file.checked);
  });
  return hit === undefined ? null : pathOf(hit);
}
