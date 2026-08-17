import Database from "better-sqlite3";
import { gzipSync, gunzipSync } from "node:zlib";
import type { FileCheckoff, PutFileState, ReviewState } from "@gander/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(repo_id, pr_number)
);
CREATE TABLE IF NOT EXISTS file_states (
  id INTEGER PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  path TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  base_hash TEXT, head_hash TEXT,
  base_content BLOB, head_content BLOB,
  checked_at TEXT, machine TEXT,
  UNIQUE(review_id, path)
);
`;

export interface Storage {
  getReview(repoId: string, prNumber: number): ReviewState;
  putFileState(repoId: string, prNumber: number, input: PutFileState): FileCheckoff;
  getSnapshot(repoId: string, prNumber: number, path: string): { baseContent: string | null; headContent: string | null } | null;
  close(): void;
}

const pack = (s: string | null): Buffer | null => (s === null ? null : gzipSync(Buffer.from(s, "utf8")));
const unpack = (b: Buffer | null): string | null => (b === null ? null : gunzipSync(b).toString("utf8"));

export function openStorage(dbPath: string): Storage {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const reviewId = (repoId: string, prNumber: number): number => {
    db.prepare("INSERT OR IGNORE INTO reviews (repo_id, pr_number) VALUES (?, ?)").run(repoId, prNumber);
    const row = db.prepare("SELECT id FROM reviews WHERE repo_id = ? AND pr_number = ?").get(repoId, prNumber) as { id: number };
    return row.id;
  };

  const rowToCheckoff = (r: { path: string; checked: number; base_hash: string | null; head_hash: string | null; checked_at: string | null; machine: string | null }): FileCheckoff => ({
    path: r.path, checked: r.checked === 1,
    baseHash: r.base_hash, headHash: r.head_hash,
    checkedAt: r.checked_at, machine: r.machine,
  });

  return {
    getReview(repoId, prNumber) {
      const rid = reviewId(repoId, prNumber);
      const rows = db.prepare("SELECT path, checked, base_hash, head_hash, checked_at, machine FROM file_states WHERE review_id = ? ORDER BY path").all(rid) as Parameters<typeof rowToCheckoff>[0][];
      return { repoId, prNumber, files: rows.map(rowToCheckoff) };
    },

    putFileState(repoId, prNumber, input) {
      const rid = reviewId(repoId, prNumber);
      if (input.checked) {
        db.prepare(`
          INSERT INTO file_states (review_id, path, checked, base_hash, head_hash, base_content, head_content, checked_at, machine)
          VALUES (?, ?, 1, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
          ON CONFLICT(review_id, path) DO UPDATE SET
            checked = 1, base_hash = excluded.base_hash, head_hash = excluded.head_hash,
            base_content = excluded.base_content, head_content = excluded.head_content,
            checked_at = excluded.checked_at, machine = excluded.machine
        `).run(rid, input.path, input.baseHash, input.headHash, pack(input.baseContent), pack(input.headContent), input.machine);
      } else {
        // Bare un-check: snapshot and hashes are retained as the delta base.
        db.prepare(`
          INSERT INTO file_states (review_id, path, checked) VALUES (?, ?, 0)
          ON CONFLICT(review_id, path) DO UPDATE SET checked = 0
        `).run(rid, input.path);
      }
      const row = db.prepare("SELECT path, checked, base_hash, head_hash, checked_at, machine FROM file_states WHERE review_id = ? AND path = ?").get(rid, input.path) as Parameters<typeof rowToCheckoff>[0];
      return rowToCheckoff(row);
    },

    getSnapshot(repoId, prNumber, path) {
      const rid = reviewId(repoId, prNumber);
      const row = db.prepare("SELECT base_content, head_content FROM file_states WHERE review_id = ? AND path = ?").get(rid, path) as { base_content: Buffer | null; head_content: Buffer | null } | undefined;
      if (!row) return null;
      return { baseContent: unpack(row.base_content), headContent: unpack(row.head_content) };
    },

    close() { db.close(); },
  };
}
