import { describe, expect, it } from "vitest";
import {
  FileCheckoffSchema,
  PutFileStateSchema,
  ReviewStateSchema,
  repoIdFromUrl,
} from "./index.js";

describe("repoIdFromUrl", () => {
  it("normalizes https and ssh GitHub URLs to owner/repo", () => {
    expect(repoIdFromUrl("https://github.com/acme/atlas.git")).toBe("acme/atlas");
    expect(repoIdFromUrl("https://github.com/acme/atlas")).toBe("acme/atlas");
    expect(repoIdFromUrl("git@github.com:acme/atlas.git")).toBe("acme/atlas");
    expect(repoIdFromUrl("ssh://git@github.com/acme/atlas.git")).toBe("acme/atlas");
  });
  it("throws on non-GitHub URLs", () => {
    expect(() => repoIdFromUrl("https://gitlab.com/a/b")).toThrow(/GitHub/);
  });
});

describe("PutFileStateSchema", () => {
  it("requires snapshot fields when checking a file", () => {
    const bad = PutFileStateSchema.safeParse({ checked: true, path: "a.rb" });
    expect(bad.success).toBe(false);
    const good = PutFileStateSchema.safeParse({
      checked: true, path: "a.rb",
      baseHash: "h1", headHash: "h2",
      baseContent: "old", headContent: "new", machine: "test-mac",
    });
    expect(good.success).toBe(true);
  });
  it("allows a bare un-check (snapshot retained server-side)", () => {
    const r = PutFileStateSchema.safeParse({ checked: false, path: "a.rb" });
    expect(r.success).toBe(true);
  });
});

describe("ReviewStateSchema", () => {
  it("round-trips a valid state", () => {
    const state = {
      repoId: "acme/atlas", prNumber: 7,
      files: [{ path: "a.rb", checked: true, baseHash: "h1", headHash: "h2", checkedAt: "2026-08-15T12:00:00Z", machine: "m1" }],
    };
    expect(ReviewStateSchema.parse(state)).toEqual(state);
    expect(FileCheckoffSchema.parse(state.files[0])).toEqual(state.files[0]);
  });
});
