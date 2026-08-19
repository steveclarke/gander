import type { ChangedFile, PrFile } from "@gander/shared";

export type TreeNode =
  | { type: "dir"; name: string; path: string; children: TreeNode[] }
  | { type: "file"; file: ChangedFile };

interface MutableDir { dirs: Map<string, MutableDir>; files: ChangedFile[]; }

export function buildTree(files: ChangedFile[]): TreeNode[] {
  const root: MutableDir = { dirs: new Map(), files: [] };
  for (const f of files) {
    const segments = f.path.split("/");
    let node = root;
    for (const seg of segments.slice(0, -1)) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg)!;
    }
    node.files.push(f);
  }

  const emit = (dir: MutableDir, prefix: string): TreeNode[] => {
    const dirNodes: TreeNode[] = [...dir.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        // compact single-child chains with no direct files
        let compactName = name;
        let compactChild = child;
        let compactPrefix = prefix ? `${prefix}/${name}` : name;
        while (compactChild.files.length === 0 && compactChild.dirs.size === 1) {
          const [nextName, nextChild] = [...compactChild.dirs.entries()][0]!;
          compactName = `${compactName}/${nextName}`;
          compactPrefix = `${compactPrefix}/${nextName}`;
          compactChild = nextChild;
        }
        return { type: "dir" as const, name: compactName, path: compactPrefix, children: emit(compactChild, compactPrefix) };
      });
    const fileNodes: TreeNode[] = dir.files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => ({ type: "file" as const, file }));
    return [...dirNodes, ...fileNodes];
  };
  return emit(root, "");
}

export function filesUnder(node: TreeNode): ChangedFile[] {
  if (node.type === "file") return [node.file];
  return node.children.flatMap(filesUnder).sort((a, b) => a.path.localeCompare(b.path));
}

export function dirState(node: TreeNode & { type: "dir" }): "all" | "some" | "none" {
  const files = filesUnder(node).filter((file): file is PrFile => "checked" in file);
  const done = files.filter((f) => f.checked).length;
  return done === 0 ? "none" : done === files.length ? "all" : "some";
}
