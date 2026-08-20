import { describe, expect, it } from "vitest";
import { basename, directoryPrefix, parentDirectory } from "./paths.js";

describe("paths", () => {
  it("reads the parts of a nested path", () => {
    expect(basename("src/main/git.ts")).toBe("git.ts");
    expect(parentDirectory("src/main/git.ts")).toBe("src/main");
    expect(directoryPrefix("src/main/git.ts")).toBe("src/main/");
  });

  it("leaves a root-level file with no directory at all", () => {
    expect(basename("README.md")).toBe("README.md");
    expect(parentDirectory("README.md")).toBe("");
    expect(directoryPrefix("README.md")).toBe("");
  });
});
