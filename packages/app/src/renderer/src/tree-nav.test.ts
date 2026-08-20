import { beforeEach, describe, expect, it } from "vitest";
import type { ChangedFile, PrFile } from "@gander/shared";
import {
  collapsedDirs,
  collapseAllDirectories,
  collapseReviewedDirectories,
  edge,
  expandAllDirectories,
  filesAt,
  nextUnmarked,
  parentOf,
  pathOf,
  rows,
  remainingOnly,
  step,
  visibleFiles,
} from "./tree-nav.js";

const file = (path: string, checked = false): PrFile =>
  ({ path, status: "M", baseContent: "", headContent: "", baseHash: "b", headHash: "h", checked, changedSince: false });

const files = [
  file("README.md"),
  file("src/app.ts", true),
  file("src/deep/inner.ts"),
  file("vendor/bundle.js"),
];

const paths = (list: ChangedFile[]): string[] => list.map((f) => f.path);

beforeEach(() => {
  collapsedDirs.clear();
  remainingOnly.value = false;
});

describe("tree navigation", () => {
  // The cursor stops on directories as well as files, the way an explorer list does —
  // otherwise there is no way to reach a directory to open or close it.
  it("walks every row the tree draws, directories included", () => {
    expect(rows(files).map(pathOf)).toEqual([
      "src", "src/deep", "src/deep/inner.ts", "src/app.ts", "vendor", "vendor/bundle.js", "README.md",
    ]);
  });

  it("leaves the contents of a collapsed directory out, but keeps its row", () => {
    collapsedDirs.add("vendor");
    expect(rows(files).map(pathOf)).toEqual([
      "src", "src/deep", "src/deep/inner.ts", "src/app.ts", "vendor", "README.md",
    ]);
    expect(paths(visibleFiles(files))).toEqual(["src/deep/inner.ts", "src/app.ts", "README.md"]);
  });

  it("expands and collapses every folder in one action", () => {
    collapseAllDirectories(files);
    expect([...collapsedDirs].sort()).toEqual(["src", "src/deep", "vendor"]);

    expandAllDirectories();
    expect([...collapsedDirs]).toEqual([]);
  });

  it("collapses reviewed folders while leaving unfinished branches open", () => {
    const review = [
      file("done/one.ts", true),
      file("done/nested/two.ts", true),
      file("working/checked.ts", true),
      file("working/left.ts", false),
    ];

    collapseReviewedDirectories(review);

    expect([...collapsedDirs]).toEqual(["done", "done/nested"]);
  });

  it("shows only unchecked files and the folders that contain them", () => {
    remainingOnly.value = true;

    expect(rows(files).map(pathOf)).toEqual([
      "src/deep", "src/deep/inner.ts", "vendor", "vendor/bundle.js", "README.md",
    ]);
    expect(rows(files.map((entry) => file(entry.path, true)))).toEqual([]);
  });

  it("stops at the ends rather than wrapping", () => {
    expect(step(files, "README.md", 1)).toBeNull();
    expect(step(files, "src", -1)).toBeNull();
  });

  it("finds the first and last row", () => {
    expect(edge(files, "first")).toBe("src");
    expect(edge(files, "last")).toBe("README.md");
  });

  it("names the directory a row sits in, and null at the top level", () => {
    expect(parentOf(files, "src/deep/inner.ts")).toBe("src/deep");
    expect(parentOf(files, "src")).toBeNull();
  });

  // Marking a directory has to cover what it holds even when it is folded away: folding is
  // about reading, not about scope.
  it("collects every file under a directory, collapsed or not", () => {
    collapsedDirs.add("src");
    expect(paths(filesAt(files, "src"))).toEqual(["src/deep/inner.ts", "src/app.ts"]);
    expect(paths(filesAt(files, "README.md"))).toEqual(["README.md"]);
  });

  it("advances to a row holding unmarked work, and wraps once", () => {
    expect(nextUnmarked(files, "src/app.ts")).toBe("vendor");
    expect(nextUnmarked(files, "README.md")).toBe("src");
  });

  it("searches backwards too", () => {
    expect(nextUnmarked(files, "README.md", -1)).toBe("vendor/bundle.js");
  });

  it("has nothing left to advance to once everything is marked", () => {
    expect(nextUnmarked(files.map((f) => file(f.path, true)), "src/app.ts")).toBeNull();
  });
});
