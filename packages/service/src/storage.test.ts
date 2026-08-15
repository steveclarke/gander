import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStorage, type Storage } from "./storage.js";

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gander-db-"));
  storage = openStorage(join(dir, "test.db"));
});
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe("storage", () => {
  it("returns an empty review for an unknown PR", () => {
    expect(storage.getReview("acme/atlas", 7)).toEqual({ repoId: "acme/atlas", prNumber: 7, files: [] });
  });

  it("persists a checkoff with its snapshot", () => {
    const out = storage.putFileState("acme/atlas", 7, {
      checked: true, path: "app/a.rb",
      baseHash: "b1", headHash: "h1",
      baseContent: "old body", headContent: "new body", machine: "studio",
    });
    expect(out.checked).toBe(true);
    expect(out.headHash).toBe("h1");
    expect(out.checkedAt).not.toBeNull();

    const review = storage.getReview("acme/atlas", 7);
    expect(review.files).toHaveLength(1);
    expect(storage.getSnapshot("acme/atlas", 7, "app/a.rb")).toEqual({ baseContent: "old body", headContent: "new body" });
  });

  it("un-check retains the snapshot (delta base for M2)", () => {
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "app/a.rb",
      baseHash: "b1", headHash: "h1",
      baseContent: "old", headContent: "new", machine: "studio",
    });
    const out = storage.putFileState("acme/atlas", 7, { checked: false, path: "app/a.rb" });
    expect(out.checked).toBe(false);
    // hashes and snapshot survive the un-check
    expect(out.headHash).toBe("h1");
    expect(storage.getSnapshot("acme/atlas", 7, "app/a.rb")).toEqual({ baseContent: "old", headContent: "new" });
  });

  it("a new checkoff overwrites the old snapshot", () => {
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "a.rb", baseHash: "b1", headHash: "h1",
      baseContent: "v1-base", headContent: "v1-head", machine: "m",
    });
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "a.rb", baseHash: "b2", headHash: "h2",
      baseContent: "v2-base", headContent: "v2-head", machine: "m",
    });
    expect(storage.getSnapshot("acme/atlas", 7, "a.rb")).toEqual({ baseContent: "v2-base", headContent: "v2-head" });
    expect(storage.getReview("acme/atlas", 7).files[0]?.headHash).toBe("h2");
  });

  it("handles null contents for added/deleted files", () => {
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "new.rb", baseHash: null, headHash: "h1",
      baseContent: null, headContent: "created", machine: "m",
    });
    expect(storage.getSnapshot("acme/atlas", 7, "new.rb")).toEqual({ baseContent: null, headContent: "created" });
  });

  it("returns the stored base content for a deleted file, not null", () => {
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "gone.rb", baseHash: null, headHash: null,
      baseContent: "old body", headContent: null, machine: "m",
    });
    expect(storage.getSnapshot("acme/atlas", 7, "gone.rb")).toEqual({ baseContent: "old body", headContent: null });
  });
});
