import { beforeEach, describe, expect, it } from "vitest";
import type { ChangedFile, PrFile } from "@gander/shared";
import {
  collapsedDirectoryAfter,
  collapsedDirs,
  directoryOf,
  edge,
  nextUnchecked,
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

beforeEach(() => collapsedDirs.clear());

describe("tree navigation", () => {
  it("walks files in the order the tree draws them", () => {
    // Directories are drawn before the files beside them, so src/deep precedes src/app.ts.
    expect(paths(visibleFiles(files))).toEqual([
      "src/deep/inner.ts", "src/app.ts", "vendor/bundle.js", "README.md",
    ]);
  });

  // Collapsing is how a reviewer sets noise aside. If the cursor stepped into a collapsed
  // directory anyway, collapsing would be decoration rather than a review gesture.
  it("steps past a collapsed directory instead of into it", () => {
    collapsedDirs.add("vendor");
    expect(step(files, "src/app.ts", 1)).toBe("README.md");
  });

  it("stops at the ends rather than wrapping", () => {
    expect(step(files, "README.md", 1)).toBeNull();
    expect(step(files, "src/deep/inner.ts", -1)).toBeNull();
  });

  it("finds the first and last visible file", () => {
    expect(edge(files, "first")).toBe("src/deep/inner.ts");
    expect(edge(files, "last")).toBe("README.md");
  });

  it("names the directory a file sits in, and null at the root", () => {
    expect(directoryOf(files, "src/deep/inner.ts")).toBe("src/deep");
    expect(directoryOf(files, "README.md")).toBeNull();
  });

  // `l` has to undo the `h` that just collapsed a directory and stepped the cursor above it.
  it("offers the first collapsed directory at or after the cursor to expand", () => {
    collapsedDirs.add("vendor");
    expect(collapsedDirectoryAfter(files, "src/app.ts")).toBe("vendor");
  });

  it("skips checked files when advancing, and wraps once", () => {
    expect(nextUnchecked(files, "src/app.ts")).toBe("vendor/bundle.js");
    expect(nextUnchecked(files, "README.md")).toBe("src/deep/inner.ts");
  });

  it("searches backwards too, so marking can walk a review in reverse", () => {
    expect(nextUnchecked(files, "README.md", -1)).toBe("vendor/bundle.js");
    expect(nextUnchecked(files, "src/deep/inner.ts", -1)).toBe("README.md");
  });

  it("has no next unchecked file once everything is checked", () => {
    expect(nextUnchecked(files.map((f) => file(f.path, true)), "src/app.ts")).toBeNull();
  });
});
