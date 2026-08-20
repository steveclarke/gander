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

  it("lists repository review state in one query without including untouched reviews", () => {
    storage.getReview("acme/atlas", 6);
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "app/a.rb",
      baseHash: "b1", headHash: "h1",
      baseContent: "old", headContent: "new", machine: "studio",
    });
    storage.putFileState("acme/other", 8, {
      checked: true, path: "other.rb",
      baseHash: "b2", headHash: "h2",
      baseContent: "old", headContent: "new", machine: "studio",
    });

    expect(storage.listReviews("acme/atlas")).toEqual([{
      repoId: "acme/atlas",
      prNumber: 7,
      files: [expect.objectContaining({ path: "app/a.rb", checked: true, headHash: "h1" })],
    }]);
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

  it("distinguishes a checked binary file (all-null snapshot) from never-checked", () => {
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "image.png", baseHash: null, headHash: null,
      baseContent: null, headContent: null, machine: "m",
    });
    expect(storage.getSnapshot("acme/atlas", 7, "image.png")).toEqual({ baseContent: null, headContent: null });
    expect(storage.getSnapshot("acme/atlas", 7, "never-touched.png")).toBeNull();
  });

  describe("notes", () => {
    it("stores a note against a file and reads it back as open", () => {
      const q = storage.addNote("acme/atlas", 7, {
        path: "a.rb", line: 12, text: "Why the retry here?", headSha: null,
        sourceContext: { startLine: 10, lines: ["before", "near", "target", "after"] },
      });
      expect(q).toMatchObject({
        path: "a.rb", line: 12, text: "Why the retry here?", state: "open",
        sourceContext: { startLine: 10, lines: ["before", "near", "target", "after"] },
      });
      expect(storage.listNotes("acme/atlas", 7)).toEqual([q]);
    });

    it("keeps a pull-request-level note, which has no file", () => {
      const q = storage.addNote("acme/atlas", 7, { path: null, line: null, text: "Squash before merge", headSha: null, sourceContext: null });
      expect(q.path).toBeNull();
      expect(storage.listNotes("acme/atlas", 7)).toHaveLength(1);
    });

    it("scopes notes to one review", () => {
      storage.addNote("acme/atlas", 7, { path: "a.rb", line: null, text: "on seven", headSha: null, sourceContext: null });
      storage.addNote("acme/atlas", 8, { path: "a.rb", line: null, text: "on eight", headSha: null, sourceContext: null });
      expect(storage.listNotes("acme/atlas", 7).map((q) => q.text)).toEqual(["on seven"]);
      expect(storage.listNotes("acme/atlas", 8).map((q) => q.text)).toEqual(["on eight"]);
    });

    it("an agent marks a note addressed with a commit and note", () => {
      const q = storage.addNote("acme/atlas", 7, { path: "a.rb", line: null, text: "Why the retry?", headSha: null, sourceContext: null });
      expect(storage.markNoteAddressed(q.id, { commitRef: "abc1234", summary: "Dropped the retry" })).toBeNull();
      storage.markNoteInProgress(q.id, { note: null });
      const marked = storage.markNoteAddressed(q.id, { commitRef: "abc1234", summary: "Dropped the retry" });
      expect(marked).toMatchObject({ state: "addressed", commitRef: "abc1234", summary: "Dropped the retry" });
    });

    it("claims a note, records why it is waiting, then addresses it without a commit", () => {
      const q = storage.addNote("acme/atlas", 7, { path: "a.rb", line: null, text: "Which behavior?", headSha: null, sourceContext: null });

      expect(storage.markNoteInProgress(q.id, { note: null })).toMatchObject({ state: "in_progress", inProgressNote: null });
      expect(storage.markNoteInProgress(q.id, { note: "Need the reviewer to choose A or B" })).toMatchObject({
        state: "in_progress",
        inProgressNote: "Need the reviewer to choose A or B",
      });
      expect(storage.markNoteInProgress(q.id, { note: null })).toMatchObject({
        state: "in_progress",
        inProgressNote: null,
      });
      storage.markNoteInProgress(q.id, { note: "Need the reviewer to choose A or B" });
      expect(storage.markNoteAddressed(q.id, { commitRef: null, summary: "The reviewer chose A." })).toMatchObject({
        state: "addressed",
        inProgressNote: null,
        commitRef: null,
        summary: "The reviewer chose A.",
      });
    });

    it("lets the reviewer edit note text and correct its state within one review", () => {
      const note = storage.addNote("acme/atlas", 7, { path: "a.rb", line: 12, text: "Old text", headSha: null, sourceContext: null });

      expect(storage.updateNote("acme/atlas", 8, note.id, { text: "Wrong review" })).toBeNull();
      expect(storage.updateNote("acme/atlas", 7, note.id, { text: "Updated text", state: "resolved" })).toMatchObject({
        id: note.id,
        text: "Updated text",
        state: "resolved",
      });
      expect(storage.listNotes("acme/atlas", 7)[0]).toMatchObject({ text: "Updated text", state: "resolved" });
    });

    it("refuses to re-address a note the reviewer already resolved", () => {
      const q = storage.addNote("acme/atlas", 7, { path: "a.rb", line: null, text: "Why?", headSha: null, sourceContext: null });
      storage.markNoteInProgress(q.id, { note: null });
      storage.markNoteAddressed(q.id, { commitRef: "abc1234", summary: "Dropped the retry" });
      storage.putFileState("acme/atlas", 7, {
        checked: true, path: "a.rb", baseHash: "b", headHash: "h",
        baseContent: "o", headContent: "n", machine: "m",
      });
      expect(storage.listNotes("acme/atlas", 7)[0]).toMatchObject({
        state: "resolved", commitRef: "abc1234", summary: "Dropped the retry",
      });
      expect(storage.markNoteAddressed(q.id, { commitRef: null, summary: null })).toBeNull();
    });

    it("re-checking a file resolves its addressed notes and leaves open ones alone", () => {
      const answered = storage.addNote("acme/atlas", 7, { path: "a.rb", line: null, text: "answered", headSha: null, sourceContext: null });
      const unanswered = storage.addNote("acme/atlas", 7, { path: "a.rb", line: null, text: "still open", headSha: null, sourceContext: null });
      const elsewhere = storage.addNote("acme/atlas", 7, { path: "b.rb", line: null, text: "other file", headSha: null, sourceContext: null });
      storage.markNoteInProgress(answered.id, { note: null });
      storage.markNoteInProgress(elsewhere.id, { note: null });
      storage.markNoteAddressed(answered.id, { commitRef: "c1", summary: null });
      storage.markNoteAddressed(elsewhere.id, { commitRef: "c2", summary: null });

      storage.putFileState("acme/atlas", 7, {
        checked: true, path: "a.rb", baseHash: "b", headHash: "h",
        baseContent: "o", headContent: "n", machine: "m",
      });

      const byId = new Map(storage.listNotes("acme/atlas", 7).map((q) => [q.id, q.state]));
      expect(byId.get(answered.id)).toBe("resolved");
      expect(byId.get(unanswered.id)).toBe("open");
      // A different file's checkoff must not resolve anything here.
      expect(byId.get(elsewhere.id)).toBe("addressed");
    });

    it("resolves a branch to its pull request", () => {
      storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
      expect(storage.findPrByHeadRef("acme/atlas", "feat/thing")).toBe(7);
      expect(storage.findPrByHeadRef("acme/atlas", "no-such-branch")).toBeNull();
    });

    it("resolves a reused branch name to the newest pull request on it", () => {
      storage.setPrContext("acme/atlas", 7, { headRef: "feat/thing", title: "Feature", headSha: "sha-1", stackId: null, stackSize: null, stackPosition: null });
      storage.setPrContext("acme/atlas", 9, { headRef: "feat/thing", title: "Newer", headSha: "sha-9", stackId: null, stackSize: null, stackPosition: null });
      expect(storage.findPrByHeadRef("acme/atlas", "feat/thing")).toBe(9);
    });

    it("deletes only within its own review", () => {
      const q = storage.addNote("acme/atlas", 7, { path: "a.rb", line: null, text: "keep me", headSha: null, sourceContext: null });
      // The same id offered against a different pull request must not delete it.
      expect(storage.deleteNote("acme/atlas", 8, q.id)).toBe(false);
      expect(storage.listNotes("acme/atlas", 7)).toHaveLength(1);
      expect(storage.deleteNote("acme/atlas", 7, q.id)).toBe(true);
      expect(storage.listNotes("acme/atlas", 7)).toEqual([]);
    });
  });
});
