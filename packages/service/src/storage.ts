import Database from "better-sqlite3";
import { gzipSync, gunzipSync } from "node:zlib";
import type { FileCheckoff, MarkAddressed, NewQuestion, NewQuestionReply, PrContext, PutFileState, Question, QuestionReply, ReviewState } from "@gander/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  head_ref TEXT,
  title TEXT,
  head_sha TEXT,
  stack_id INTEGER,
  stack_size INTEGER,
  stack_position INTEGER,
  reviewer_reply_cursor INTEGER NOT NULL DEFAULT 0,
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
CREATE TABLE IF NOT EXISTS question_replies (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK(author IN ('reviewer', 'agent')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS question_replies_by_question ON question_replies(question_id, id);
`;

export interface Storage {
  getReview(repoId: string, prNumber: number): ReviewState;
  /** Reviews with file state, fetched together for repository-level progress summaries. */
  listReviews(repoId: string): ReviewState[];
  putFileState(repoId: string, prNumber: number, input: PutFileState): FileCheckoff;
  getSnapshot(repoId: string, prNumber: number, path: string): { baseContent: string | null; headContent: string | null } | null;
  /** Records what the app knows about a pull request, so agents can be told which one they are on. */
  setPrContext(repoId: string, prNumber: number, context: PrContext): void;
  getPrContext(repoId: string, prNumber: number): PrContext | null;
  /** Every pull request recorded as part of the same stack, with how many open questions each holds. */
  listStackMembers(repoId: string, stackId: number): Array<{ prNumber: number; headRef: string | null; title: string | null; position: number | null; openQuestions: number }>;
  findPrByHeadRef(repoId: string, headRef: string): number | null;
  /** Monotonic per-review cursor advanced only by replies from the reviewer. */
  getReviewerReplyCursor(repoId: string, prNumber: number): number;
  markQuestionAddressed(id: number, input: MarkAddressed): Question | null;
  listQuestions(repoId: string, prNumber: number): Question[];
  addQuestion(repoId: string, prNumber: number, input: NewQuestion): Question;
  addReviewerReply(repoId: string, prNumber: number, id: number, input: NewQuestionReply): QuestionReply | null;
  addAgentReply(id: number, input: NewQuestionReply): QuestionReply | null;
  deleteQuestion(repoId: string, prNumber: number, id: number): boolean;
  close(): void;
}

interface QuestionRow { id: number; path: string | null; line: number | null; text: string; state: string; head_sha: string | null; commit_ref: string | null; note: string | null; created_at: string }
interface QuestionReplyRow { id: number; question_id: number; author: string; text: string; created_at: string }

const rowToReply = (r: QuestionReplyRow): QuestionReply => ({
  id: r.id,
  author: r.author as QuestionReply["author"],
  text: r.text,
  createdAt: r.created_at,
});

const rowToQuestion = (r: QuestionRow, replies: QuestionReply[] = []): Question => ({
  id: r.id, path: r.path, line: r.line, text: r.text,
  state: r.state as Question["state"],
  headSha: r.head_sha,
  commitRef: r.commit_ref, note: r.note,
  createdAt: r.created_at,
  replies,
});

const QUESTION_COLUMNS = "id, path, line, text, state, head_sha, commit_ref, note, created_at";

const pack = (s: string | null): Buffer | null => (s === null ? null : gzipSync(Buffer.from(s, "utf8")));
const unpack = (b: Buffer | null): string | null => (b === null ? null : gunzipSync(b).toString("utf8"));

export function openStorage(dbPath: string): Storage {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
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

  const repliesForQuestion = (id: number): QuestionReply[] =>
    (db.prepare("SELECT id, question_id, author, text, created_at FROM question_replies WHERE question_id = ? ORDER BY id").all(id) as QuestionReplyRow[])
      .map(rowToReply);

  const replyById = (id: number | bigint): QuestionReply =>
    rowToReply(db.prepare("SELECT id, question_id, author, text, created_at FROM question_replies WHERE id = ?").get(id) as QuestionReplyRow);

  return {
    getReview(repoId, prNumber) {
      const rid = reviewId(repoId, prNumber);
      const rows = db.prepare("SELECT path, checked, base_hash, head_hash, checked_at, machine FROM file_states WHERE review_id = ? ORDER BY path").all(rid) as Parameters<typeof rowToCheckoff>[0][];
      return { repoId, prNumber, files: rows.map(rowToCheckoff) };
    },

    listReviews(repoId) {
      const rows = db.prepare(`
        SELECT r.pr_number, fs.path, fs.checked, fs.base_hash, fs.head_hash, fs.checked_at, fs.machine
        FROM reviews r
        JOIN file_states fs ON fs.review_id = r.id
        WHERE r.repo_id = ?
        ORDER BY r.pr_number, fs.path
      `).all(repoId) as Array<Parameters<typeof rowToCheckoff>[0] & { pr_number: number }>;
      const reviews = new Map<number, FileCheckoff[]>();
      for (const row of rows) {
        const files = reviews.get(row.pr_number) ?? [];
        files.push(rowToCheckoff(row));
        reviews.set(row.pr_number, files);
      }
      return [...reviews].map(([prNumber, files]) => ({ repoId, prNumber, files }));
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
      db.prepare("UPDATE reviews SET head_ref = ?, title = ?, head_sha = ?, stack_id = ?, stack_size = ?, stack_position = ? WHERE id = ?")
        .run(context.headRef, context.title, context.headSha, context.stackId, context.stackSize, context.stackPosition, rid);
    },

    listStackMembers(repoId, stackId) {
      return db.prepare(`
        SELECT r.pr_number, r.head_ref, r.title, r.stack_position,
               (SELECT COUNT(*) FROM questions q WHERE q.review_id = r.id AND q.state = 'open') AS open_questions
        FROM reviews r
        WHERE r.repo_id = ? AND r.stack_id = ?
        ORDER BY r.stack_position
      `).all(repoId, stackId).map((r) => {
        const row = r as { pr_number: number; head_ref: string | null; title: string | null; stack_position: number | null; open_questions: number };
        return {
          prNumber: row.pr_number, headRef: row.head_ref, title: row.title,
          position: row.stack_position, openQuestions: row.open_questions,
        };
      });
    },

    getPrContext(repoId, prNumber) {
      const row = db.prepare("SELECT head_ref, title, head_sha, stack_id, stack_size, stack_position FROM reviews WHERE repo_id = ? AND pr_number = ?")
        .get(repoId, prNumber) as { head_ref: string | null; title: string | null; head_sha: string | null; stack_id: number | null; stack_size: number | null; stack_position: number | null } | undefined;
      // Null when the pull request has never been opened in the app, so nothing recorded it.
      if (!row || row.head_ref === null || row.head_sha === null) return null;
      return {
        headRef: row.head_ref, title: row.title ?? "", headSha: row.head_sha,
        stackId: row.stack_id, stackSize: row.stack_size, stackPosition: row.stack_position,
      };
    },

    findPrByHeadRef(repoId, headRef) {
      // Newest first: a branch name can be reused after its pull request closes.
      const row = db.prepare("SELECT pr_number FROM reviews WHERE repo_id = ? AND head_ref = ? ORDER BY pr_number DESC LIMIT 1").get(repoId, headRef) as { pr_number: number } | undefined;
      return row?.pr_number ?? null;
    },

    getReviewerReplyCursor(repoId, prNumber) {
      const rid = reviewId(repoId, prNumber);
      const row = db.prepare("SELECT reviewer_reply_cursor FROM reviews WHERE id = ?").get(rid) as { reviewer_reply_cursor: number };
      return row.reviewer_reply_cursor;
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
      return rowToQuestion(db.prepare(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = ?`).get(id) as QuestionRow, repliesForQuestion(id));
    },

    listQuestions(repoId, prNumber) {
      const rid = reviewId(repoId, prNumber);
      const rows = db.prepare(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE review_id = ? ORDER BY id`).all(rid) as QuestionRow[];
      const replyRows = db.prepare(`
        SELECT qr.id, qr.question_id, qr.author, qr.text, qr.created_at
        FROM question_replies qr
        JOIN questions q ON q.id = qr.question_id
        WHERE q.review_id = ?
        ORDER BY qr.id
      `).all(rid) as QuestionReplyRow[];
      const replies = new Map<number, QuestionReply[]>();
      for (const row of replyRows) {
        const current = replies.get(row.question_id) ?? [];
        current.push(rowToReply(row));
        replies.set(row.question_id, current);
      }
      return rows.map((row) => rowToQuestion(row, replies.get(row.id) ?? []));
    },

    addQuestion(repoId, prNumber, input) {
      const rid = reviewId(repoId, prNumber);
      const { lastInsertRowid } = db
        .prepare("INSERT INTO questions (review_id, path, line, text, head_sha) VALUES (?, ?, ?, ?, ?)")
        .run(rid, input.path, input.line, input.text, input.headSha);
      const row = db.prepare(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = ?`).get(lastInsertRowid) as QuestionRow;
      return rowToQuestion(row);
    },

    addReviewerReply(repoId, prNumber, id, input) {
      const rid = reviewId(repoId, prNumber);
      return db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO question_replies (question_id, author, text)
          SELECT q.id, 'reviewer', ? FROM questions q WHERE q.id = ? AND q.review_id = ?
        `).run(input.text, id, rid);
        if (result.changes === 0) return null;
        db.prepare("UPDATE reviews SET reviewer_reply_cursor = reviewer_reply_cursor + 1 WHERE id = ?").run(rid);
        return replyById(result.lastInsertRowid);
      })();
    },

    addAgentReply(id, input) {
      const result = db.prepare(`
        INSERT INTO question_replies (question_id, author, text)
        SELECT id, 'agent', ? FROM questions WHERE id = ?
      `).run(input.text, id);
      return result.changes === 0 ? null : replyById(result.lastInsertRowid);
    },

    deleteQuestion(repoId, prNumber, id) {
      // Scoped to the review so an id from one pull request cannot delete another's.
      const rid = reviewId(repoId, prNumber);
      return db.prepare("DELETE FROM questions WHERE id = ? AND review_id = ?").run(id, rid).changes > 0;
    },

    close() { db.close(); },
  };
}
