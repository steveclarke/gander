import Database from "better-sqlite3";
import { chmodSync, existsSync, renameSync } from "node:fs";

const [databasePath = "/data/gander.db", backupPath] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!backupPath) throw new Error("Usage: migrate-0.6.0.ts DATABASE_PATH BACKUP_PATH");
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

    const columns = new Set((database.pragma("table_info(notes)") as Array<{ name: string }>).map((column) => column.name));
    const missing = ["source_context", "in_progress_note"].filter((column) => !columns.has(column));
    database.transaction(() => {
      if (!columns.has("source_context")) database.exec("ALTER TABLE notes ADD COLUMN source_context TEXT");
      if (!columns.has("in_progress_note")) database.exec("ALTER TABLE notes ADD COLUMN in_progress_note TEXT");
    })();

    console.log(`Backed up ${databasePath} to ${backupPath}`);
    console.log(missing.length > 0 ? "Applied the 0.6.0 note-state migration." : "The 0.6.0 note-state migration was already applied.");
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
