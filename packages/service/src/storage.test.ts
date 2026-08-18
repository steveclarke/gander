import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
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

  it("distinguishes a checked binary file (all-null snapshot) from never-checked", () => {
    storage.putFileState("acme/atlas", 7, {
      checked: true, path: "image.png", baseHash: null, headHash: null,
      baseContent: null, headContent: null, machine: "m",
    });
    expect(storage.getSnapshot("acme/atlas", 7, "image.png")).toEqual({ baseContent: null, headContent: null });
    expect(storage.getSnapshot("acme/atlas", 7, "never-touched.png")).toBeNull();
  });

  describe("questions", () => {
    it("stores a question against a file and reads it back as open", () => {
      const q = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: 12, text: "Why the retry here?" });
      expect(q).toMatchObject({ path: "a.rb", line: 12, text: "Why the retry here?", state: "open" });
      expect(storage.listQuestions("acme/atlas", 7)).toEqual([q]);
    });

    it("keeps a pull-request-level note, which has no file", () => {
      const q = storage.addQuestion("acme/atlas", 7, { path: null, line: null, text: "Squash before merge" });
      expect(q.path).toBeNull();
      expect(storage.listQuestions("acme/atlas", 7)).toHaveLength(1);
    });

    it("scopes questions to one review", () => {
      storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "on seven" });
      storage.addQuestion("acme/atlas", 8, { path: "a.rb", line: null, text: "on eight" });
      expect(storage.listQuestions("acme/atlas", 7).map((q) => q.text)).toEqual(["on seven"]);
      expect(storage.listQuestions("acme/atlas", 8).map((q) => q.text)).toEqual(["on eight"]);
    });

    it("an agent marks a question addressed with a commit and note", () => {
      const q = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "Why the retry?" });
      const marked = storage.markQuestionAddressed(q.id, { commitRef: "abc1234", note: "Dropped the retry" });
      expect(marked).toMatchObject({ state: "addressed", commitRef: "abc1234", note: "Dropped the retry" });
    });

    it("refuses to re-address a question the reviewer already resolved", () => {
      const q = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "Why?" });
      storage.markQuestionAddressed(q.id, { commitRef: null, note: null });
      storage.putFileState("acme/atlas", 7, {
        checked: true, path: "a.rb", baseHash: "b", headHash: "h",
        baseContent: "o", headContent: "n", machine: "m",
      });
      expect(storage.listQuestions("acme/atlas", 7)[0]!.state).toBe("resolved");
      expect(storage.markQuestionAddressed(q.id, { commitRef: null, note: null })).toBeNull();
    });

    it("re-checking a file resolves its addressed questions and leaves open ones alone", () => {
      const answered = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "answered" });
      const unanswered = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "still open" });
      const elsewhere = storage.addQuestion("acme/atlas", 7, { path: "b.rb", line: null, text: "other file" });
      storage.markQuestionAddressed(answered.id, { commitRef: "c1", note: null });
      storage.markQuestionAddressed(elsewhere.id, { commitRef: "c2", note: null });

      storage.putFileState("acme/atlas", 7, {
        checked: true, path: "a.rb", baseHash: "b", headHash: "h",
        baseContent: "o", headContent: "n", machine: "m",
      });

      const byId = new Map(storage.listQuestions("acme/atlas", 7).map((q) => [q.id, q.state]));
      expect(byId.get(answered.id)).toBe("resolved");
      expect(byId.get(unanswered.id)).toBe("open");
      // A different file's checkoff must not resolve anything here.
      expect(byId.get(elsewhere.id)).toBe("addressed");
    });

    it("resolves a branch to its pull request", () => {
      storage.setHeadRef("acme/atlas", 7, "feat/thing");
      expect(storage.findPrByHeadRef("acme/atlas", "feat/thing")).toBe(7);
      expect(storage.findPrByHeadRef("acme/atlas", "no-such-branch")).toBeNull();
    });

    it("resolves a reused branch name to the newest pull request on it", () => {
      storage.setHeadRef("acme/atlas", 7, "feat/thing");
      storage.setHeadRef("acme/atlas", 9, "feat/thing");
      expect(storage.findPrByHeadRef("acme/atlas", "feat/thing")).toBe(9);
    });

    it("deletes only within its own review", () => {
      const q = storage.addQuestion("acme/atlas", 7, { path: "a.rb", line: null, text: "keep me" });
      // The same id offered against a different pull request must not delete it.
      expect(storage.deleteQuestion("acme/atlas", 8, q.id)).toBe(false);
      expect(storage.listQuestions("acme/atlas", 7)).toHaveLength(1);
      expect(storage.deleteQuestion("acme/atlas", 7, q.id)).toBe(true);
      expect(storage.listQuestions("acme/atlas", 7)).toEqual([]);
    });
  });

  describe("migration from an earlier schema", () => {
    it("adds the columns a database written before question states is missing", () => {
      // A database exactly as the previous version left it: questions without
      // commit_ref/note/addressed_at, reviews without head_ref.
      const oldPath = join(dir, "old.db");
      const old = new Database(oldPath);
      old.exec(`
        CREATE TABLE reviews (id INTEGER PRIMARY KEY, repo_id TEXT NOT NULL, pr_number INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(repo_id, pr_number));
        CREATE TABLE file_states (id INTEGER PRIMARY KEY, review_id INTEGER NOT NULL REFERENCES reviews(id),
          path TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, base_hash TEXT, head_hash TEXT,
          base_content BLOB, head_content BLOB, checked_at TEXT, machine TEXT, UNIQUE(review_id, path));
        CREATE TABLE questions (id INTEGER PRIMARY KEY, review_id INTEGER NOT NULL REFERENCES reviews(id),
          path TEXT, line INTEGER, text TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        INSERT INTO reviews (repo_id, pr_number) VALUES ('acme/atlas', 7);
        INSERT INTO questions (review_id, path, text) VALUES (1, 'a.rb', 'captured before the upgrade');
      `);
      old.close();

      const upgraded = openStorage(oldPath);
      try {
        // The question written by the old version is still there and reads back whole.
        expect(upgraded.listQuestions("acme/atlas", 7)).toMatchObject([
          { path: "a.rb", text: "captured before the upgrade", state: "open", commitRef: null, note: null },
        ]);
        // And the new columns work rather than throwing on first write.
        const id = upgraded.listQuestions("acme/atlas", 7)[0]!.id;
        expect(upgraded.markQuestionAddressed(id, { commitRef: "abc", note: "done" })?.state).toBe("addressed");
        upgraded.setHeadRef("acme/atlas", 7, "feat/thing");
        expect(upgraded.findPrByHeadRef("acme/atlas", "feat/thing")).toBe(7);
      } finally {
        upgraded.close();
      }
    });
  });
});