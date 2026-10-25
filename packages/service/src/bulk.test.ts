import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SERVICE_VERSION, type PutFileState } from "@gander/shared";
import { openStorage, type Storage } from "./storage.js";
import { buildServer } from "./server.js";

let dir: string; let storage: Storage; let server: ReturnType<typeof buildServer>;
const checked = (path: string): PutFileState => ({ path, checked: true, baseHash: "base", headHash: "head", baseContent: "before", headContent: "after", machine: "test" });
const route = "/api/reviews/acme%2Fatlas/1/files/bulk";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gander-bulk-")); storage = openStorage(join(dir, "review.db"));
  server = buildServer({ storage, token: "test", version: SERVICE_VERSION });
});
afterEach(async () => { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });

it("applies ordered repeated paths, retains snapshots and resolves only addressed notes", async () => {
  const notes = ["open", "active", "done"].map((text) => storage.addNote("acme/atlas", 1, { path: "a.ts", line: null, text, headSha: null, sourceContext: null }));
  storage.markNoteInProgress(notes[1]!.id, { note: "Working" });
  storage.markNoteAddressed(notes[2]!.id, { summary: "Fixed", commitRef: null });
  const response = await server.inject({ method: "PUT", url: route, headers: { authorization: "Bearer test" }, payload: { files: [checked("a.ts"), { path: "a.ts", checked: false }, checked("b.ts")] } });
  expect(response.statusCode).toBe(200);
  expect(response.json().map((file: { path: string; checked: boolean }) => [file.path, file.checked])).toEqual([["a.ts", true], ["a.ts", false], ["b.ts", true]]);
  expect(storage.getReview("acme/atlas", 1).files.map((file) => file.checked)).toEqual([false, true]);
  expect(storage.getSnapshot("acme/atlas", 1, "a.ts")).toEqual({ baseContent: "before", headContent: "after" });
  expect(storage.listNotes("acme/atlas", 1).map((note) => note.state)).toEqual(["open", "in_progress", "resolved"]);
});

it.each([[], [checked("a.ts"), { path: "b.ts", checked: true }], Array.from({ length: 501 }, (_, i) => checked(`${i}.ts`))].map((files) => ({ files })))("validates the entire batch before writing", async ({ files }) => {
  const response = await server.inject({ method: "PUT", url: route, headers: { authorization: "Bearer test" }, payload: { files } });
  expect(response.statusCode).toBe(400); expect(response.json()).toHaveProperty("error");
  expect(storage.getReview("acme/atlas", 1).files).toEqual([]);
});

it("rolls back snapshots and note resolution when a later SQL write fails", async () => {
  const note = storage.addNote("acme/atlas", 1, { path: "a.ts", line: null, text: "Fix", headSha: null, sourceContext: null });
  storage.markNoteAddressed(note.id, { summary: "Done", commitRef: null });
  const db = new Database(join(dir, "review.db"));
  db.exec("CREATE TRIGGER fail_checkoff BEFORE INSERT ON file_states WHEN NEW.path = 'fail' BEGIN SELECT RAISE(ABORT, 'failed write'); END"); db.close();
  expect(() => storage.putFileStates("acme/atlas", 1, [checked("a.ts"), checked("fail")])).toThrow("failed write");
  expect(storage.getReview("acme/atlas", 1).files).toEqual([]);
  expect(storage.getSnapshot("acme/atlas", 1, "a.ts")).toBeNull();
  expect(storage.listNotes("acme/atlas", 1)[0]!.state).toBe("addressed");
});

it("requires authentication and bounds the whole body", async () => {
  expect((await server.inject({ method: "PUT", url: route, payload: { files: [checked("a.ts")] } })).statusCode).toBe(401);
  const response = await server.inject({ method: "PUT", url: route, headers: { authorization: "Bearer test" }, payload: { files: [{ ...checked("a.ts"), headContent: "a".repeat(16 * 1024 * 1024) }] } });
  expect(response.statusCode).toBe(413);
  expect(storage.getReview("acme/atlas", 1).files).toEqual([]);
});
