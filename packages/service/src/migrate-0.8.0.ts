import Database from "better-sqlite3";
import { chmodSync, existsSync, renameSync } from "node:fs";

const [databasePath = "/data/gander.db", backupPath] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!backupPath) throw new Error("Usage: migrate-0.8.0.ts DATABASE_PATH BACKUP_PATH");
  if (!existsSync(databasePath)) {
    console.log("No existing database; the service will create the current schema.");
    return;
  }
  if (existsSync(backupPath)) throw new Error(`Refusing to overwrite backup: ${backupPath}`);
  const partialBackupPath = `${backupPath}.partial`;
  if (existsSync(partialBackupPath)) throw new Error(`Remove the incomplete backup before retrying: ${partialBackupPath}`);

  const database = new Database(databasePath);
  try {
    await database.backup(partialBackupPath);
    chmodSync(partialBackupPath, 0o600);

    const backup = new Database(partialBackupPath, { readonly: true });
    try {
      const integrity = backup.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${String(integrity)}`);
    } finally {
      backup.close();
    }
    renameSync(partialBackupPath, backupPath);

    const tables = new Set((database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name));
    if (!tables.has("reviews") || !tables.has("notes")) {
      console.log(`Backed up ${databasePath} to ${backupPath}`);
      console.log("No existing review schema; the service will create the current schema.");
      return;
    }

    const reviewColumns = new Set((database.pragma("table_info(reviews)") as Array<{ name: string }>).map(({ name }) => name));
    const noteColumns = new Set((database.pragma("table_info(notes)") as Array<{ name: string }>).map(({ name }) => name));
    const needsMigration = !reviewColumns.has("next_note_number") || !noteColumns.has("review_number");

    database.transaction(() => {
      if (!reviewColumns.has("next_note_number")) {
        database.exec("ALTER TABLE reviews ADD COLUMN next_note_number INTEGER NOT NULL DEFAULT 1");
      }

      if (!noteColumns.has("review_number")) {
        // Rebuilding makes both identities explicit invariants: global ids never recycle,
        // and every note has one immutable number within its pull-request review.
        database.exec(`
          CREATE TABLE notes_0_8_0 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            review_id INTEGER NOT NULL REFERENCES reviews(id),
            review_number INTEGER NOT NULL,
            path TEXT,
            line INTEGER,
            text TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'open',
            head_sha TEXT,
            source_context TEXT,
            in_progress_note TEXT,
            commit_ref TEXT,
            summary TEXT,
            addressed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );
          INSERT INTO notes_0_8_0 (
            id, review_id, review_number, path, line, text, state, head_sha,
            source_context, in_progress_note, commit_ref, summary, addressed_at, created_at
          )
          SELECT
            note.id,
            note.review_id,
            (
              SELECT COUNT(*)
              FROM notes AS earlier
              WHERE earlier.review_id = note.review_id AND earlier.id <= note.id
            ),
            note.path, note.line, note.text, note.state, note.head_sha,
            note.source_context, note.in_progress_note, note.commit_ref, note.summary,
            note.addressed_at, note.created_at
          FROM notes AS note
          ORDER BY note.id;
          DROP TABLE notes;
          ALTER TABLE notes_0_8_0 RENAME TO notes;
          CREATE INDEX notes_by_review ON notes(review_id);
          CREATE UNIQUE INDEX note_numbers_by_review ON notes(review_id, review_number);
        `);
      } else {
        database.exec("CREATE UNIQUE INDEX IF NOT EXISTS note_numbers_by_review ON notes(review_id, review_number)");
      }

      database.exec(`
        UPDATE reviews
        SET next_note_number = COALESCE(
          (SELECT MAX(note.review_number) + 1 FROM notes AS note WHERE note.review_id = reviews.id),
          1
        )
      `);
    })();

    console.log(`Backed up ${databasePath} to ${backupPath}`);
    console.log(needsMigration ? "Applied the 0.8.0 note-number migration." : "The 0.8.0 note-number migration was already applied.");
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
