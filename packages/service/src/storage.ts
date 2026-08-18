import Database from "better-sqlite3";
import { gzipSync, gunzipSync } from "node:zlib";
import type { FileCheckoff, MarkAddressed, NewQuestion, PrContext, PutFileState, Question, ReviewState } from "@gander/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  head_ref TEXT,
  title TEXT,
  head_sha TEXT,
  stack_size INTEGER,
  stack_position INTEGER,
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
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  path TEXT,
  line INTEGER,
  text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  head_sha TEXT,
  commit_ref TEXT,
  note TEXT,
  addressed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS questions_by_review ON questions(review_id);
`;

export interface Storage {
  getReview(repoId: string, prNumber: number): ReviewState;
  putFileState(repoId: string, prNumber: number, input: PutFileState): FileCheckoff;
  getSnapshot(repoId: string, prNumber: number, path: string): { baseContent: string | null; headContent: string | null } | null;
  /** Records what the app knows about a pull request, so agents can be told which one they are on. */
  setPrContext(repoId: string, prNumber: number, context: PrContext): void;
  getPrContext(repoId: string, prNumber: number): PrContext | null;
  findPrByHeadRef(repoId: string, headRef: string): number | null;
  markQuestionAddressed(id: number, input: MarkAddressed): Question | null;
  listQuestions(repoId: string, prNumber: number): Question[];
  addQuestion(repoId: string, prNumber: number, input: NewQuestion): Question;
  deleteQuestion(repoId: string, prNumber: number, id: number): boolean;
  close(): void;
}

interface QuestionRow { id: number; path: string | null; line: number | null; text: string; state: string; head_sha: string | null; commit_ref: string | null; note: string | null; created_at: string }

const rowToQuestion = (r: QuestionRow): Question => ({
  id: r.id, path: r.path, line: r.line, text: r.text,
  state: r.state as Question["state"],
  headSha: r.head_sha,
  commitRef: r.commit_ref, note: r.note,
  createdAt: r.created_at,
});

const QUESTION_COLUMNS = "id, path, line, text, state, head_sha, commit_ref, note, created_at";

/**
 * CREATE TABLE IF NOT EXISTS silently does nothing to a table that already exists, so a
 * database written by an earlier version keeps its old column set and the first insert
 * against a new column fails at the user's desk while every test — which starts from an
 * empty file — stays green. Each column is added only if the live table lacks it.
 */
function migrate(db: Database.Database): void {
  const addColumn = (table: string, column: string, type: string): void => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn("questions", "commit_ref", "TEXT");
  addColumn("questions", "note", "TEXT");
  addColumn("questions", "addressed_at", "TEXT");
  addColumn("questions", "head_sha", "TEXT");
  addColumn("reviews", "head_ref", "TEXT");
  addColumn("reviews", "title", "TEXT");
  addColumn("reviews", "head_sha", "TEXT");
  addColumn("reviews", "stack_size", "INTEGER");
  addColumn("reviews", "stack_position", "INTEGER");
}

const pack = (s: string | null): Buffer | null => (s === null ? null : gzipSync(Buffer.from(s, "utf8")));
const unpack = (b: Buffer | null): string | null => (b === null ? null : gunzipSync(b).toString("utf8"));

export function openStorage(dbPath: string): Storage {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);

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
        // Re-checking a file is the reviewer confirming the agent's work: its addressed
        // questions become resolved. Open questions survive — they were never answered.
        db.prepare("UPDATE questions SET state = 'resolved' WHERE review_id = ? AND path = ? AND state = 'addressed'").run(rid, input.path);
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

    setPrContext(repoId, prNumber, context) {
      const rid = reviewId(repoId, prNumber);
      db.prepare("UPDATE reviews SET head_ref = ?, title = ?, head_sha = ?, stack_size = ?, stack_position = ? WHERE id = ?")
        .run(context.headRef, context.title, context.headSha, context.stackSize, context.stackPosition, rid);
    },

    getPrContext(repoId, prNumber) {
      const row = db.prepare("SELECT head_ref, title, head_sha, stack_size, stack_position FROM reviews WHERE repo_id = ? AND pr_number = ?")
        .get(repoId, prNumber) as { head_ref: string | null; title: string | null; head_sha: string | null; stack_size: number | null; stack_position: number | null } | undefined;
      // Null when the pull request has never been opened in the app, so nothing recorded it.
      if (!row || row.head_ref === null || row.head_sha === null) return null;
      return {
        headRef: row.head_ref, title: row.title ?? "", headSha: row.head_sha,
        stackSize: row.stack_size, stackPosition: row.stack_position,
      };
    },

    findPrByHeadRef(repoId, headRef) {
      // Newest first: a branch name can be reused after its pull request closes.
      const row = db.prepare("SELECT pr_number FROM reviews WHERE repo_id = ? AND head_ref = ? ORDER BY pr_number DESC LIMIT 1").get(repoId, headRef) as { pr_number: number } | undefined;
      return row?.pr_number ?? null;
    },

    markQuestionAddressed(id, input) {
      // Only an open question can be addressed. Re-addressing a resolved one would
      // undo the reviewer's own act, and the spec puts resolution solely in their hands.
      const changed = db.prepare(`
        UPDATE questions
        SET state = 'addressed', commit_ref = ?, note = ?, addressed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND state = 'open'
      `).run(input.commitRef, input.note, id).changes;
      if (changed === 0) return null;
      return rowToQuestion(db.prepare(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = ?`).get(id) as QuestionRow);
    },

    listQuestions(repoId, prNumber) {
      const rid = reviewId(repoId, prNumber);
      const rows = db.prepare(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE review_id = ? ORDER BY id`).all(rid) as QuestionRow[];
      return rows.map(rowToQuestion);
    },

    addQuestion(repoId, prNumber, input) {
      const rid = reviewId(repoId, prNumber);
      const { lastInsertRowid } = db
        .prepare("INSERT INTO questions (review_id, path, line, text, head_sha) VALUES (?, ?, ?, ?, ?)")
        .run(rid, input.path, input.line, input.text, input.headSha);
      const row = db.prepare(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = ?`).get(lastInsertRowid) as QuestionRow;
      return rowToQuestion(row);
    },

    deleteQuestion(repoId, prNumber, id) {
      // Scoped to the review so an id from one pull request cannot delete another's.
      const rid = reviewId(repoId, prNumber);
      return db.prepare("DELETE FROM questions WHERE id = ? AND review_id = ?").run(id, rid).changes > 0;
    },

    close() { db.close(); },
  };
}
