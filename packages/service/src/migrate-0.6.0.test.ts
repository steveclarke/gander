import Database from "better-sqlite3";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const command = join(serviceRoot, "node_modules/.bin/tsx");
const script = join(serviceRoot, "src/migrate-0.6.0.ts");
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gander-migrate-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("0.6.0 production database migration", () => {
  it("backs up the database before adding the note-state columns", () => {
    const databasePath = join(dir, "gander.db");
    const backupPath = join(dir, "gander.backup.db");
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open',
        head_sha TEXT,
        commit_ref TEXT,
        summary TEXT,
        addressed_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO notes (id, text, state, created_at)
      VALUES (41, 'Keep this review note', 'open', '2026-08-19T12:30:00.000Z');
    `);
    database.close();

    const result = spawnSync(command, [script, databasePath, backupPath], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);

    const backup = new Database(backupPath, { readonly: true });
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(backup.prepare("SELECT id, text, state, created_at FROM notes").get()).toEqual({
      id: 41,
      text: "Keep this review note",
      state: "open",
      created_at: "2026-08-19T12:30:00.000Z",
    });
    expect((backup.pragma("table_info(notes)") as Array<{ name: string }>).map(({ name }) => name)).not.toContain("source_context");
    backup.close();

    const migrated = new Database(databasePath, { readonly: true });
    expect((migrated.pragma("table_info(notes)") as Array<{ name: string }>).map(({ name }) => name)).toEqual(expect.arrayContaining([
      "source_context",
      "in_progress_note",
    ]));
    expect(migrated.prepare("SELECT id, text, state, created_at FROM notes").get()).toEqual({
      id: 41,
      text: "Keep this review note",
      state: "open",
      created_at: "2026-08-19T12:30:00.000Z",
    });
    migrated.close();
  });
});
