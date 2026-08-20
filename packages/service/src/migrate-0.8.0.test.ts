import Database from "better-sqlite3";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const command = join(serviceRoot, "node_modules/.bin/tsx");
const script = join(serviceRoot, "src/migrate-0.8.0.ts");
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gander-migrate-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("0.8.0 production database migration", () => {
  it("backs up the database and numbers existing notes within each review", () => {
    const databasePath = join(dir, "gander.db");
    const backupPath = join(dir, "gander.backup.db");
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE reviews (
        id INTEGER PRIMARY KEY,
        repo_id TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        head_ref TEXT,
        title TEXT,
        head_sha TEXT,
        stack_id INTEGER,
        stack_size INTEGER,
        stack_position INTEGER,
        UNIQUE(repo_id, pr_number)
      );
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        review_id INTEGER NOT NULL REFERENCES reviews(id),
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
        created_at TEXT NOT NULL
      );
      CREATE INDEX notes_by_review ON notes(review_id);
      INSERT INTO reviews (id, repo_id, pr_number, created_at)
      VALUES (7, 'acme/atlas', 12, '2026-08-19T12:00:00.000Z'),
             (8, 'acme/atlas', 13, '2026-08-19T12:00:00.000Z');
      INSERT INTO notes (id, review_id, text, state, created_at)
      VALUES (1, 7, 'First on twelve', 'resolved', '2026-08-19T12:30:00.000Z'),
             (3, 8, 'First on thirteen', 'open', '2026-08-19T12:31:00.000Z'),
             (4, 7, 'Second on twelve', 'open', '2026-08-19T12:32:00.000Z');
    `);
    database.close();

    const result = spawnSync(command, [script, databasePath, backupPath], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);

    const backup = new Database(backupPath, { readonly: true });
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((backup.pragma("table_info(notes)") as Array<{ name: string }>).map(({ name }) => name)).not.toContain("review_number");
    backup.close();

    const migrated = new Database(databasePath);
    expect(migrated.prepare("SELECT id, review_id, review_number, text, state FROM notes ORDER BY id").all()).toEqual([
      { id: 1, review_id: 7, review_number: 1, text: "First on twelve", state: "resolved" },
      { id: 3, review_id: 8, review_number: 1, text: "First on thirteen", state: "open" },
      { id: 4, review_id: 7, review_number: 2, text: "Second on twelve", state: "open" },
    ]);
    expect(migrated.prepare("SELECT id, next_note_number FROM reviews ORDER BY id").all()).toEqual([
      { id: 7, next_note_number: 3 },
      { id: 8, next_note_number: 2 },
    ]);
    expect(() => migrated.prepare("INSERT INTO notes (review_id, review_number, text) VALUES (7, 2, 'Duplicate')").run()).toThrow(/UNIQUE/);
    migrated.prepare("DELETE FROM notes WHERE id = 4").run();
    const inserted = migrated.prepare("INSERT INTO notes (review_id, review_number, text) VALUES (7, 3, 'After delete')").run();
    expect(Number(inserted.lastInsertRowid)).toBeGreaterThan(4);
    migrated.close();
  });
});
