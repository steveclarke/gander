# Gander M1 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The core review loop working end to end: register a GitHub repo, open one of its PRs, review its files in a unified Monaco diff with tri-state tree checkoff, with review state persisted through the review service and un-checked automatically when file content changes.

**Architecture:** pnpm monorepo with three packages. `@gander/shared` holds domain types and zod schemas. `@gander/service` is a Fastify + better-sqlite3 HTTP API (the source of truth for authored review state). `@gander/app` is an Electron (electron-vite) + Vue 3 + Monaco desktop app whose main process owns git (bare clones, real `git` binary), the GitHub API client, and the service client; the renderer is pure UI over a typed IPC bridge.

**Tech Stack:** TypeScript (strict, ESM), pnpm workspaces, Fastify, better-sqlite3, zod, Electron + electron-vite, Vue 3 (`<script setup>`), monaco-editor, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-gander-design.md` — read it first. This plan implements the spec's PR-review mode only; questions/MCP (M2), local viewer (M3), and packaging/CI/read-cache (M4) are later plans.

## Global Constraints

- TypeScript `strict: true` in every package; ESM only (`"type": "module"`).
- Node ≥ 22, pnpm ≥ 9. Install the latest stable of each dependency at execution time — versions in this plan are floors, not pins.
- **Never mock git.** Git-layer tests build real throwaway repos and run the real `git` binary. GitHub HTTP is faked only via an injected `fetch`.
- Service binds `127.0.0.1` by default; every `/api/*` route requires `Authorization: Bearer <token>`; `/healthz` does not.
- No secrets in the repo, ever. Tokens come from env or the user's config file.
- Diff view is unified by default (`renderSideBySide: false`).
- UI follows the approved mockup `docs/mockups/mockup-v4.html`: dark theme, segmented header, tree pane + diff pane.
- Failures are loud: every caught error surfaces its actual message to the UI or test output. No silent catch-and-continue.
- Commit at the end of every task (conventional-commit style subject lines).

---

### Task 1: Monorepo scaffold + shared package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `@gander/shared` exporting the types and schemas below — every later task imports from it verbatim.

- [ ] **Step 1: Write the workspace scaffold**

`package.json` (root):

```json
{
  "name": "gander",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`.gitignore`:

```
node_modules/
dist/
out/
*.db
*.log
.DS_Store
```

`.nvmrc`: `22`

`packages/shared/package.json`:

```json
{
  "name": "@gander/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": { "zod": "^3.24.0" }
}
```

`packages/shared/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the failing test for the shared schemas**

`packages/shared/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FileCheckoffSchema,
  PutFileStateSchema,
  ReviewStateSchema,
  repoIdFromUrl,
} from "./index.js";

describe("repoIdFromUrl", () => {
  it("normalizes https and ssh GitHub URLs to owner/repo", () => {
    expect(repoIdFromUrl("https://github.com/acme/atlas.git")).toBe("acme/atlas");
    expect(repoIdFromUrl("https://github.com/acme/atlas")).toBe("acme/atlas");
    expect(repoIdFromUrl("git@github.com:acme/atlas.git")).toBe("acme/atlas");
  });
  it("throws on non-GitHub URLs", () => {
    expect(() => repoIdFromUrl("https://gitlab.com/a/b")).toThrow(/GitHub/);
  });
});

describe("PutFileStateSchema", () => {
  it("requires snapshot fields when checking a file", () => {
    const bad = PutFileStateSchema.safeParse({ checked: true, path: "a.rb" });
    expect(bad.success).toBe(false);
    const good = PutFileStateSchema.safeParse({
      checked: true, path: "a.rb",
      baseHash: "h1", headHash: "h2",
      baseContent: "old", headContent: "new", machine: "test-mac",
    });
    expect(good.success).toBe(true);
  });
  it("allows a bare un-check (snapshot retained server-side)", () => {
    const r = PutFileStateSchema.safeParse({ checked: false, path: "a.rb" });
    expect(r.success).toBe(true);
  });
});

describe("ReviewStateSchema", () => {
  it("round-trips a valid state", () => {
    const state = {
      repoId: "acme/atlas", prNumber: 7,
      files: [{ path: "a.rb", checked: true, baseHash: "h1", headHash: "h2", checkedAt: "2026-08-15T12:00:00Z", machine: "m1" }],
    };
    expect(ReviewStateSchema.parse(state)).toEqual(state);
    expect(FileCheckoffSchema.parse(state.files[0])).toEqual(state.files[0]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm install && pnpm vitest run packages/shared`
Expected: FAIL — `index.js` has no exports yet.

- [ ] **Step 4: Implement the shared package**

`packages/shared/src/index.ts`:

```ts
import { z } from "zod";

export const FileStatusSchema = z.enum(["A", "M", "D", "R"]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const FileCheckoffSchema = z.object({
  path: z.string().min(1),
  checked: z.boolean(),
  baseHash: z.string().nullable(),
  headHash: z.string().nullable(),
  checkedAt: z.string().nullable(),
  machine: z.string().nullable(),
});
export type FileCheckoff = z.infer<typeof FileCheckoffSchema>;

export const ReviewStateSchema = z.object({
  repoId: z.string().regex(/^[^/]+\/[^/]+$/),
  prNumber: z.number().int().positive(),
  files: z.array(FileCheckoffSchema),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const PutFileStateSchema = z.discriminatedUnion("checked", [
  z.object({
    checked: z.literal(true),
    path: z.string().min(1),
    baseHash: z.string().nullable(),
    headHash: z.string().nullable(),
    baseContent: z.string().nullable(),
    headContent: z.string().nullable(),
    machine: z.string().min(1),
  }),
  z.object({ checked: z.literal(false), path: z.string().min(1) }),
]);
export type PutFileState = z.infer<typeof PutFileStateSchema>;

export interface PrSummary {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  baseRef: string;
  baseSha: string;
  headSha: string;
}

export interface RepoEntry { repoId: string; url: string; }

export interface PrFile {
  path: string;
  status: FileStatus;
  baseContent: string | null;
  headContent: string | null;
  baseHash: string | null;
  headHash: string | null;
  checked: boolean;
  changedSince: boolean;
}

export interface PrView { pr: PrSummary; files: PrFile[]; }

/** "https://github.com/o/r(.git)" | "git@github.com:o/r(.git)" -> "o/r" */
export function repoIdFromUrl(url: string): string {
  const m =
    url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ??
    url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Not a GitHub repository URL: ${url}`);
  return `${m[1]}/${m[2]}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/shared`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: monorepo scaffold and @gander/shared schemas"
```

---

### Task 2: Service storage layer (SQLite)

**Files:**
- Create: `packages/service/package.json`, `packages/service/tsconfig.json`, `packages/service/src/storage.ts`
- Test: `packages/service/src/storage.test.ts`

**Interfaces:**
- Consumes: `FileCheckoff`, `ReviewState`, `PutFileState` from `@gander/shared`.
- Produces:
  - `openStorage(dbPath: string): Storage`
  - `interface Storage { getReview(repoId: string, prNumber: number): ReviewState; putFileState(repoId: string, prNumber: number, input: PutFileState): FileCheckoff; getSnapshot(repoId: string, prNumber: number, path: string): { baseContent: string | null; headContent: string | null } | null; close(): void; }`

- [ ] **Step 1: Create the package**

`packages/service/package.json`:

```json
{
  "name": "@gander/service",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "dev": "node --experimental-strip-types src/main.ts" },
  "dependencies": {
    "@gander/shared": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "fastify": "^5.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": { "@types/better-sqlite3": "^7.6.0", "@types/node": "^22.0.0" }
}
```

`packages/service/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Write the failing storage tests**

`packages/service/src/storage.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm install && pnpm vitest run packages/service`
Expected: FAIL — `storage.js` does not exist.

- [ ] **Step 4: Implement the storage layer**

`packages/service/src/storage.ts`:

```ts
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
      const row = db.prepare("SELECT base_content, head_content, head_hash FROM file_states WHERE review_id = ? AND path = ?").get(rid, path) as { base_content: Buffer | null; head_content: Buffer | null; head_hash: string | null } | undefined;
      if (!row || (row.head_hash === null && row.base_content === null && row.head_content === null)) return null;
      return { baseContent: unpack(row.base_content), headContent: unpack(row.head_content) };
    },

    close() { db.close(); },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(service): SQLite storage with snapshot-retaining un-check"
```

---

### Task 3: Service HTTP API

**Files:**
- Create: `packages/service/src/server.ts`, `packages/service/src/main.ts`
- Test: `packages/service/src/server.test.ts`

**Interfaces:**
- Consumes: `openStorage`/`Storage` (Task 2); `PutFileStateSchema`, `ReviewState` (Task 1).
- Produces:
  - `buildServer(opts: { storage: Storage; token: string; version: string }): FastifyInstance`
  - Routes: `GET /healthz` → `{ ok: true, version }` (no auth). `GET /api/reviews/:repoId/:prNumber` → `ReviewState` (repoId URL-encoded, e.g. `acme%2Fatlas`). `PUT /api/reviews/:repoId/:prNumber/files` with `PutFileState` body → `FileCheckoff`. All `/api/*` require `Authorization: Bearer <token>`, else 401.

- [ ] **Step 1: Write the failing API tests**

`packages/service/src/server.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { openStorage, type Storage } from "./storage.js";
import { buildServer } from "./server.js";

let dir: string; let storage: Storage; let server: FastifyInstance;
const AUTH = { authorization: "Bearer test-token" };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gander-api-"));
  storage = openStorage(join(dir, "t.db"));
  server = buildServer({ storage, token: "test-token", version: "0.1.0" });
  await server.ready();
});
afterEach(async () => { await server.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });

describe("service API", () => {
  it("healthz is open and reports version", async () => {
    const res = await server.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: "0.1.0" });
  });

  it("rejects missing or wrong bearer token", async () => {
    const noAuth = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7" });
    expect(noAuth.statusCode).toBe(401);
    const badAuth = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7", headers: { authorization: "Bearer nope" } });
    expect(badAuth.statusCode).toBe(401);
  });

  it("GET returns an empty review; PUT round-trips a checkoff", async () => {
    const empty = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7", headers: AUTH });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ repoId: "acme/atlas", prNumber: 7, files: [] });

    const put = await server.inject({
      method: "PUT", url: "/api/reviews/acme%2Fatlas/7/files", headers: AUTH,
      payload: { checked: true, path: "a.rb", baseHash: "b1", headHash: "h1", baseContent: "o", headContent: "n", machine: "studio" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().checked).toBe(true);

    const after = await server.inject({ method: "GET", url: "/api/reviews/acme%2Fatlas/7", headers: AUTH });
    expect(after.json().files).toHaveLength(1);
  });

  it("rejects a malformed PUT body with 400 and the zod message", async () => {
    const res = await server.inject({
      method: "PUT", url: "/api/reviews/acme%2Fatlas/7/files", headers: AUTH,
      payload: { checked: true, path: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/path|machine|Hash/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/service/src/server.test.ts`
Expected: FAIL — `server.js` does not exist.

- [ ] **Step 3: Implement the server**

`packages/service/src/server.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { PutFileStateSchema } from "@gander/shared";
import type { Storage } from "./storage.js";

export function buildServer(opts: { storage: Storage; token: string; version: string }): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({ ok: true, version: opts.version }));

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.headers.authorization !== `Bearer ${opts.token}`) {
      await reply.code(401).send({ error: "missing or invalid bearer token" });
    }
  });

  app.get<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber",
    async (req) => opts.storage.getReview(decodeURIComponent(req.params.repoId), Number(req.params.prNumber)),
  );

  app.put<{ Params: { repoId: string; prNumber: string } }>(
    "/api/reviews/:repoId/:prNumber/files",
    async (req, reply) => {
      const parsed = PutFileStateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      }
      return opts.storage.putFileState(decodeURIComponent(req.params.repoId), Number(req.params.prNumber), parsed.data);
    },
  );

  return app;
}
```

`packages/service/src/main.ts`:

```ts
import { openStorage } from "./storage.js";
import { buildServer } from "./server.js";

const port = Number(process.env.GANDER_PORT ?? 8390);
const host = process.env.GANDER_HOST ?? "127.0.0.1";
const dbPath = process.env.GANDER_DB ?? "gander.db";
const token = process.env.GANDER_TOKEN;
if (!token) { console.error("GANDER_TOKEN is required"); process.exit(1); }

const storage = openStorage(dbPath);
const server = buildServer({ storage, token, version: "0.1.0" });
server.listen({ port, host }).then(() => console.log(`gander service on http://${host}:${port}`));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/service`
Expected: PASS (storage + server suites).

- [ ] **Step 5: Smoke the real process**

Run: `GANDER_TOKEN=t GANDER_DB=/tmp/g.db pnpm --filter @gander/service dev & sleep 1 && curl -s localhost:8390/healthz && kill %1`
Expected: `{"ok":true,"version":"0.1.0"}`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(service): Fastify API with bearer auth and review routes"
```

---

### Task 4: App scaffold (electron-vite + Vue) with typed IPC skeleton

**Files:**
- Create: `packages/app/package.json`, `packages/app/tsconfig.json`, `packages/app/electron.vite.config.ts`
- Create: `packages/app/src/main/index.ts`, `packages/app/src/main/config.ts`, `packages/app/src/preload/index.ts`
- Create: `packages/app/src/renderer/index.html`, `packages/app/src/renderer/src/main.ts`, `packages/app/src/renderer/src/App.vue`, `packages/app/src/renderer/src/api.ts`
- Test: `packages/app/src/main/config.test.ts`

**Interfaces:**
- Consumes: `RepoEntry` from `@gander/shared`.
- Produces:
  - `loadConfig(path?: string): GanderConfig` and `saveConfig(cfg: GanderConfig, path?: string): void` where `interface GanderConfig { serviceUrl: string; serviceToken: string; githubToken?: string; repos: RepoEntry[]; }` (default path `~/.config/gander/config.json`, overridable via `GANDER_CONFIG` env).
  - `window.gander: GanderApi` — the renderer-facing bridge. In this task every method throws `"not implemented"`; Tasks 7–11 fill them in. `interface GanderApi { listRepos(): Promise<RepoEntry[]>; addRepo(url: string): Promise<RepoEntry>; listPrs(repoId: string): Promise<PrSummary[]>; openPr(repoId: string, prNumber: number): Promise<PrView>; setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>; refreshPr(repoId: string, prNumber: number): Promise<PrView>; }`
  - IPC channel names: `gander:listRepos`, `gander:addRepo`, `gander:listPrs`, `gander:openPr`, `gander:setChecked`, `gander:refreshPr`.

- [ ] **Step 1: Create the package and config files**

`packages/app/package.json`:

```json
{
  "name": "@gander/app",
  "version": "0.1.0",
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": { "dev": "electron-vite dev", "build": "electron-vite build" },
  "dependencies": {
    "@gander/shared": "workspace:*",
    "monaco-editor": "^0.52.0",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@vitejs/plugin-vue": "^5.2.0",
    "electron": "^33.0.0",
    "electron-vite": "^3.0.0",
    "vue-tsc": "^2.2.0"
  }
}
```

`packages/app/electron.vite.config.ts`:

```ts
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [vue()] },
});
```

`packages/app/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"], "compilerOptions": { "module": "ESNext", "moduleResolution": "bundler", "types": ["node"] } }
```

- [ ] **Step 2: Write the failing config-loader test**

`packages/app/src/main/config.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "./config.js";

let dir: string; let cfgPath: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gander-cfg-")); cfgPath = join(dir, "config.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config", () => {
  it("throws a descriptive error when the file is missing", () => {
    expect(() => loadConfig(cfgPath)).toThrow(/config file not found/i);
  });
  it("throws when required keys are absent", () => {
    writeFileSync(cfgPath, JSON.stringify({ serviceUrl: "http://x" }));
    expect(() => loadConfig(cfgPath)).toThrow(/serviceToken/);
  });
  it("round-trips repos through save/load", () => {
    saveConfig({ serviceUrl: "http://h:8390", serviceToken: "t", repos: [{ repoId: "acme/atlas", url: "https://github.com/acme/atlas" }] }, cfgPath);
    const cfg = loadConfig(cfgPath);
    expect(cfg.repos[0]?.repoId).toBe("acme/atlas");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm vitest run packages/app`
Expected: FAIL — `config.js` does not exist.

- [ ] **Step 4: Implement config, main, preload, renderer shell**

`packages/app/src/main/config.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { RepoEntry } from "@gander/shared";

const ConfigSchema = z.object({
  serviceUrl: z.string().url(),
  serviceToken: z.string().min(1),
  githubToken: z.string().min(1).optional(),
  repos: z.array(z.object({ repoId: z.string(), url: z.string() })).default([]),
});
export interface GanderConfig { serviceUrl: string; serviceToken: string; githubToken?: string; repos: RepoEntry[]; }

const defaultPath = (): string => process.env.GANDER_CONFIG ?? join(homedir(), ".config", "gander", "config.json");

export function loadConfig(path = defaultPath()): GanderConfig {
  if (!existsSync(path)) throw new Error(`Gander config file not found at ${path} — create it with serviceUrl and serviceToken`);
  const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`Invalid config at ${path}: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return parsed.data;
}

export function saveConfig(cfg: GanderConfig, path = defaultPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}
```

`packages/app/src/main/index.ts`:

```ts
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

const CHANNELS = ["listRepos", "addRepo", "listPrs", "openPr", "setChecked", "refreshPr"] as const;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360, height: 860,
    backgroundColor: "#16181d",
    webPreferences: { preload: join(import.meta.dirname, "../preload/index.mjs") },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

for (const ch of CHANNELS) {
  ipcMain.handle(`gander:${ch}`, async () => { throw new Error(`gander:${ch} not implemented yet`); });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
```

`packages/app/src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(`gander:${ch}`, ...args);

contextBridge.exposeInMainWorld("gander", {
  listRepos: invoke("listRepos"),
  addRepo: invoke("addRepo"),
  listPrs: invoke("listPrs"),
  openPr: invoke("openPr"),
  setChecked: invoke("setChecked"),
  refreshPr: invoke("refreshPr"),
});
```

`packages/app/src/renderer/src/api.ts`:

```ts
import type { PrSummary, PrView, RepoEntry } from "@gander/shared";

export interface GanderApi {
  listRepos(): Promise<RepoEntry[]>;
  addRepo(url: string): Promise<RepoEntry>;
  listPrs(repoId: string): Promise<PrSummary[]>;
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
  refreshPr(repoId: string, prNumber: number): Promise<PrView>;
}
export const api = (window as unknown as { gander: GanderApi }).gander;
```

`packages/app/src/renderer/index.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Gander</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
  </head>
  <body style="margin:0;background:#16181d">
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`packages/app/src/renderer/src/main.ts`:

```ts
import { createApp } from "vue";
import App from "./App.vue";
createApp(App).mount("#app");
```

`packages/app/src/renderer/src/App.vue`:

```vue
<script setup lang="ts">
// Shell placeholder — replaced in Task 8.
</script>

<template>
  <div style="color:#d7dae0;font:13px -apple-system,sans-serif;padding:2rem">Gander — shell OK</div>
</template>
```

- [ ] **Step 5: Run tests, then launch the app manually**

Run: `pnpm vitest run packages/app`
Expected: PASS (config suite).
Run: `pnpm --filter @gander/app dev`
Expected: a dark window opens showing "Gander — shell OK". Quit it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): electron-vite scaffold with typed IPC bridge and config loader"
```

---

### Task 5: Git engine (bare clones, PR fetch, diff, blob access)

**Files:**
- Create: `packages/app/src/main/git.ts`
- Test: `packages/app/src/main/git.test.ts`, `packages/app/src/main/fixtures.ts`

**Interfaces:**
- Consumes: `FileStatus` from `@gander/shared`.
- Produces:
  - `createGitEngine(clonesRoot: string): GitEngine`
  - `interface GitEngine { ensureClone(repoId: string, url: string): Promise<string>; fetchPr(cloneDir: string, prNumber: number, baseRef: string): Promise<void>; mergeBase(cloneDir: string, a: string, b: string): Promise<string>; diffFiles(cloneDir: string, base: string, head: string): Promise<Array<{ path: string; status: FileStatus }>>; showFile(cloneDir: string, rev: string, path: string): Promise<string | null>; resolveRef(cloneDir: string, ref: string): Promise<string>; }`
  - Ref layout inside a clone: PR head at `refs/gander/pr/<n>`, base branch at `refs/gander/base/<baseRef>`.
  - Test helper `makeFixtureRepo()` (used again by M3): builds a real repo with `main` + a feature branch + `refs/pull/1/head`, returns `{ dir, git(args): Promise<string> }`.

- [ ] **Step 1: Write the fixture builder**

`packages/app/src/main/fixtures.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface FixtureRepo { dir: string; git(args: string[]): Promise<string>; }

/** Real repo: main (a.rb, unchanged.txt), feature branch editing a.rb + adding b.rb, refs/pull/1/head -> feature. */
export async function makeFixtureRepo(): Promise<FixtureRepo> {
  const dir = mkdtempSync(join(tmpdir(), "gander-fixture-"));
  const git = async (args: string[]): Promise<string> =>
    (await run("git", ["-C", dir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })).stdout.trim();

  await git(["init", "-b", "main"]);
  writeFileSync(join(dir, "a.rb"), "class A\nend\n");
  writeFileSync(join(dir, "unchanged.txt"), "same\n");
  await git(["add", "-A"]); await git(["commit", "-m", "initial"]);
  await git(["checkout", "-b", "feature"]);
  writeFileSync(join(dir, "a.rb"), "class A\n  def go; end\nend\n");
  writeFileSync(join(dir, "b.rb"), "class B\nend\n");
  await git(["add", "-A"]); await git(["commit", "-m", "feature work"]);
  const headSha = await git(["rev-parse", "HEAD"]);
  await git(["update-ref", "refs/pull/1/head", headSha]);
  await git(["checkout", "main"]);
  return { dir, git };
}
```

- [ ] **Step 2: Write the failing git-engine tests**

`packages/app/src/main/git.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitEngine, type GitEngine } from "./git.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";

let fixture: FixtureRepo; let clonesRoot: string; let engine: GitEngine;

beforeEach(async () => {
  fixture = await makeFixtureRepo();
  clonesRoot = mkdtempSync(join(tmpdir(), "gander-clones-"));
  engine = createGitEngine(clonesRoot);
});
afterEach(() => { rmSync(fixture.dir, { recursive: true, force: true }); rmSync(clonesRoot, { recursive: true, force: true }); });

describe("git engine", () => {
  it("clones bare, fetches a PR, and diffs base...head", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const base = await engine.resolveRef(clone, "refs/gander/base/main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const mb = await engine.mergeBase(clone, base, head);
    expect(mb).toBe(base); // feature branched off main tip

    const files = await engine.diffFiles(clone, mb, head);
    expect(files).toEqual([
      { path: "a.rb", status: "M" },
      { path: "b.rb", status: "A" },
    ]);
  });

  it("ensureClone is idempotent and fetchPr picks up new commits", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    // advance the PR in origin
    await fixture.git(["checkout", "feature"]);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(fixture.dir, "c.rb"), "class C\nend\n");
    await fixture.git(["add", "-A"]); await fixture.git(["commit", "-m", "more"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const again = await engine.ensureClone("acme/atlas", fixture.dir);
    expect(again).toBe(clone);
    await engine.fetchPr(clone, 1, "main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    const files = await engine.diffFiles(clone, await engine.resolveRef(clone, "refs/gander/base/main"), head);
    expect(files.map((f) => f.path)).toContain("c.rb");
  });

  it("showFile returns content for existing paths and null for absent ones", async () => {
    const clone = await engine.ensureClone("acme/atlas", fixture.dir);
    await engine.fetchPr(clone, 1, "main");
    const head = await engine.resolveRef(clone, "refs/gander/pr/1");
    expect(await engine.showFile(clone, head, "b.rb")).toBe("class B\nend\n");
    const base = await engine.resolveRef(clone, "refs/gander/base/main");
    expect(await engine.showFile(clone, base, "b.rb")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run packages/app/src/main/git.test.ts`
Expected: FAIL — `git.js` does not exist.

- [ ] **Step 4: Implement the git engine**

`packages/app/src/main/git.ts`:

```ts
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileStatus } from "@gander/shared";

const run = promisify(execFile);

export interface GitEngine {
  ensureClone(repoId: string, url: string): Promise<string>;
  fetchPr(cloneDir: string, prNumber: number, baseRef: string): Promise<void>;
  mergeBase(cloneDir: string, a: string, b: string): Promise<string>;
  diffFiles(cloneDir: string, base: string, head: string): Promise<Array<{ path: string; status: FileStatus }>>;
  showFile(cloneDir: string, rev: string, path: string): Promise<string | null>;
  resolveRef(cloneDir: string, ref: string): Promise<string>;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`git ${args.join(" ")} failed: ${e.stderr?.trim() || e.message}`);
  }
}

export function createGitEngine(clonesRoot: string): GitEngine {
  return {
    async ensureClone(repoId, url) {
      const dir = join(clonesRoot, repoId.replace("/", "__") + ".git");
      if (!existsSync(dir)) {
        mkdirSync(clonesRoot, { recursive: true });
        await git(clonesRoot, ["clone", "--bare", url, dir]);
      }
      return dir;
    },

    async fetchPr(cloneDir, prNumber, baseRef) {
      await git(cloneDir, [
        "fetch", "--force", "origin",
        `+refs/pull/${prNumber}/head:refs/gander/pr/${prNumber}`,
        `+refs/heads/${baseRef}:refs/gander/base/${baseRef}`,
      ]);
    },

    async mergeBase(cloneDir, a, b) {
      return (await git(cloneDir, ["merge-base", a, b])).trim();
    },

    async diffFiles(cloneDir, base, head) {
      const out = await git(cloneDir, ["diff", "--name-status", "-M", base, head]);
      return out.split("\n").filter(Boolean).map((line) => {
        const parts = line.split("\t");
        const raw = (parts[0] ?? "").charAt(0) as FileStatus | "C";
        // Renames/copies report old\tnew — the new path is the reviewable file.
        const path = (raw === "R" || raw === "C" ? parts[2] : parts[1]) ?? "";
        const status: FileStatus = raw === "C" ? "A" : (raw as FileStatus);
        return { path, status };
      });
    },

    async showFile(cloneDir, rev, path) {
      try {
        return await git(cloneDir, ["show", `${rev}:${path}`]);
      } catch (err) {
        const msg = (err as Error).message;
        if (/does not exist|exists on disk, but not in|invalid object name|bad revision/i.test(msg)) return null;
        throw err;
      }
    },

    async resolveRef(cloneDir, ref) {
      return (await git(cloneDir, ["rev-parse", ref])).trim();
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/app/src/main/git.test.ts`
Expected: PASS (3 tests, real git underneath).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): git engine over real git — bare clones, PR refs, diffs, blobs"
```

---

### Task 6: GitHub client (token resolution + PR listing)

**Files:**
- Create: `packages/app/src/main/github.ts`
- Test: `packages/app/src/main/github.test.ts`

**Interfaces:**
- Consumes: `PrSummary` from `@gander/shared`.
- Produces:
  - `listOpenPrs(repoId: string, token: string, fetchImpl?: typeof fetch): Promise<PrSummary[]>`
  - `resolveGithubToken(configToken?: string): Promise<string>` — order: `gh auth token` → `GANDER_GITHUB_TOKEN` env → `configToken` → throw `Error` naming all three options.

- [ ] **Step 1: Write the failing tests (injected fetch — never live network)**

`packages/app/src/main/github.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listOpenPrs, resolveGithubToken } from "./github.js";

const ghPr = {
  number: 987, title: "Late-fee automation", body: "Adds calculator", draft: true,
  base: { ref: "main", sha: "aaa111" }, head: { sha: "bbb222" },
};

describe("listOpenPrs", () => {
  it("maps the GitHub REST shape to PrSummary", async () => {
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.github.com/repos/acme/atlas/pulls?state=open&per_page=50");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(JSON.stringify([ghPr]), { status: 200 });
    }) as typeof fetch;

    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);
    expect(prs).toEqual([{ number: 987, title: "Late-fee automation", body: "Adds calculator", draft: true, baseRef: "main", baseSha: "aaa111", headSha: "bbb222" }]);
  });

  it("surfaces API errors loudly with status and body", async () => {
    const fakeFetch = (async () => new Response("rate limited", { status: 403 })) as typeof fetch;
    await expect(listOpenPrs("acme/atlas", "tok", fakeFetch)).rejects.toThrow(/403.*rate limited/s);
  });

  it("treats null body as empty string", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify([{ ...ghPr, body: null }]), { status: 200 })) as typeof fetch;
    const prs = await listOpenPrs("acme/atlas", "tok", fakeFetch);
    expect(prs[0]?.body).toBe("");
  });
});

describe("resolveGithubToken", () => {
  it("falls back to env when gh is unavailable", async () => {
    process.env.GANDER_GITHUB_TOKEN = "env-tok";
    process.env.PATH = "/nonexistent"; // makes `gh` unfindable for this test
    try {
      expect(await resolveGithubToken()).toBe("env-tok");
    } finally { delete process.env.GANDER_GITHUB_TOKEN; process.env.PATH = process.env.PATH; }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/app/src/main/github.test.ts`
Expected: FAIL — `github.js` does not exist.

- [ ] **Step 3: Implement the client**

`packages/app/src/main/github.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrSummary } from "@gander/shared";

const run = promisify(execFile);

interface GhPr {
  number: number; title: string; body: string | null; draft: boolean;
  base: { ref: string; sha: string }; head: { sha: string };
}

export async function listOpenPrs(repoId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<PrSummary[]> {
  const res = await fetchImpl(`https://api.github.com/repos/${repoId}/pulls?state=open&per_page=50`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repoId}: ${await res.text()}`);
  const prs = (await res.json()) as GhPr[];
  return prs.map((p) => ({
    number: p.number, title: p.title, body: p.body ?? "", draft: p.draft,
    baseRef: p.base.ref, baseSha: p.base.sha, headSha: p.head.sha,
  }));
}

export async function resolveGithubToken(configToken?: string): Promise<string> {
  try {
    const { stdout } = await run("gh", ["auth", "token"]);
    if (stdout.trim()) return stdout.trim();
  } catch { /* gh missing or not logged in — fall through */ }
  if (process.env.GANDER_GITHUB_TOKEN) return process.env.GANDER_GITHUB_TOKEN;
  if (configToken) return configToken;
  throw new Error("No GitHub token: log in with `gh auth login`, set GANDER_GITHUB_TOKEN, or add githubToken to the config file");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/app/src/main/github.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): GitHub client with layered token resolution"
```

---

### Task 7: Main-process orchestration — the open/refresh/checkoff pipeline

This is the semantic core: it merges git truth with service state and enforces the content-based un-check rule from the spec.

**Files:**
- Create: `packages/app/src/main/service-client.ts`, `packages/app/src/main/review.ts`
- Modify: `packages/app/src/main/index.ts` (replace the not-implemented handlers)
- Test: `packages/app/src/main/review.test.ts`

**Interfaces:**
- Consumes: `GitEngine` (Task 5), `listOpenPrs`/`resolveGithubToken` (Task 6), service routes (Task 3), config (Task 4), shared types.
- Produces:
  - `createServiceClient(baseUrl: string, token: string): ServiceClient` with `getReview(repoId, prNumber): Promise<ReviewState>` and `putFileState(repoId, prNumber, input: PutFileState): Promise<FileCheckoff>` (network errors throw with the service URL in the message).
  - `createReviewer(deps: ReviewerDeps): Reviewer` where `interface ReviewerDeps { git: GitEngine; service: ServiceClient; listPrs(repoId: string): Promise<PrSummary[]>; repoUrl(repoId: string): string; machine: string; }` and `interface Reviewer { openPr(repoId: string, prNumber: number): Promise<PrView>; setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>; }` (`refreshPr` = `openPr` re-run; the IPC layer aliases it).
  - Un-check rule implemented here: stored `checked=true` but current `headHash`/`baseHash` differ → view shows `checked:false, changedSince:true` AND the un-check is persisted via `putFileState({checked:false})` (snapshot retained server-side).

- [ ] **Step 1: Write the failing pipeline test — real git, real service, fake GitHub**

`packages/app/src/main/review.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrSummary } from "@gander/shared";
import { buildServer } from "../../../service/src/server.js";
import { openStorage, type Storage } from "../../../service/src/storage.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";
import { createGitEngine } from "./git.js";
import { createServiceClient } from "./service-client.js";
import { createReviewer, type Reviewer } from "./review.js";

let fixture: FixtureRepo; let clonesRoot: string; let dbDir: string;
let storage: Storage; let server: FastifyInstance; let reviewer: Reviewer;

async function currentPr(fx: FixtureRepo): Promise<PrSummary> {
  const headSha = await fx.git(["rev-parse", "refs/pull/1/head"]);
  const baseSha = await fx.git(["rev-parse", "main"]);
  return { number: 1, title: "Feature", body: "", draft: false, baseRef: "main", baseSha, headSha };
}

beforeEach(async () => {
  fixture = await makeFixtureRepo();
  clonesRoot = mkdtempSync(join(tmpdir(), "gander-clones-"));
  dbDir = mkdtempSync(join(tmpdir(), "gander-db-"));
  storage = openStorage(join(dbDir, "t.db"));
  server = buildServer({ storage, token: "t", version: "test" });
  await server.listen({ port: 0, host: "127.0.0.1" });
  const port = (server.addresses()[0] as { port: number }).port;

  reviewer = createReviewer({
    git: createGitEngine(clonesRoot),
    service: createServiceClient(`http://127.0.0.1:${port}`, "t"),
    listPrs: async () => [await currentPr(fixture)],
    repoUrl: () => fixture.dir,
    machine: "test-machine",
  });
});
afterEach(async () => {
  await server.close(); storage.close();
  for (const d of [fixture.dir, clonesRoot, dbDir]) rmSync(d, { recursive: true, force: true });
});

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("review pipeline", () => {
  it("openPr returns the PR's files with contents and unchecked state", async () => {
    const view = await reviewer.openPr("acme/atlas", 1);
    expect(view.pr.number).toBe(1);
    expect(view.files.map((f) => [f.path, f.status])).toEqual([["a.rb", "M"], ["b.rb", "A"]]);
    const a = view.files[0]!;
    expect(a.baseContent).toBe("class A\nend\n");
    expect(a.headContent).toBe("class A\n  def go; end\nend\n");
    expect(a.headHash).toBe(sha256(a.headContent!));
    expect(a.checked).toBe(false);
    expect(a.changedSince).toBe(false);
  });

  it("setChecked persists through the service and survives re-open", async () => {
    await reviewer.openPr("acme/atlas", 1);
    const view = await reviewer.setChecked("acme/atlas", 1, "a.rb", true);
    expect(view.files.find((f) => f.path === "a.rb")!.checked).toBe(true);

    const reopened = await reviewer.openPr("acme/atlas", 1);
    expect(reopened.files.find((f) => f.path === "a.rb")!.checked).toBe(true);
  });

  it("content change after checkoff un-checks with changedSince — and identical content survives history rewrites", async () => {
    await reviewer.openPr("acme/atlas", 1);
    await reviewer.setChecked("acme/atlas", 1, "a.rb", true);
    await reviewer.setChecked("acme/atlas", 1, "b.rb", true);

    // Amend the PR: a.rb changes content; b.rb is rewritten into a new commit with identical content.
    await fixture.git(["checkout", "feature"]);
    writeFileSync(join(fixture.dir, "a.rb"), "class A\n  def go; puts 1; end\nend\n");
    await fixture.git(["add", "-A"]);
    await fixture.git(["commit", "--amend", "-m", "rewritten feature"]);
    await fixture.git(["update-ref", "refs/pull/1/head", await fixture.git(["rev-parse", "HEAD"])]);
    await fixture.git(["checkout", "main"]);

    const view = await reviewer.openPr("acme/atlas", 1);
    const a = view.files.find((f) => f.path === "a.rb")!;
    const b = view.files.find((f) => f.path === "b.rb")!;
    expect(a.checked).toBe(false);
    expect(a.changedSince).toBe(true);
    expect(b.checked).toBe(true);        // content identical -> review survives the force-push
    expect(b.changedSince).toBe(false);

    // The un-check was persisted, not just displayed:
    const reopened = await reviewer.openPr("acme/atlas", 1);
    expect(reopened.files.find((f) => f.path === "a.rb")!.checked).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/app/src/main/review.test.ts`
Expected: FAIL — `service-client.js` / `review.js` do not exist.

- [ ] **Step 3: Implement the service client**

`packages/app/src/main/service-client.ts`:

```ts
import type { FileCheckoff, PutFileState, ReviewState } from "@gander/shared";

export interface ServiceClient {
  getReview(repoId: string, prNumber: number): Promise<ReviewState>;
  putFileState(repoId: string, prNumber: number, input: PutFileState): Promise<FileCheckoff>;
}

export function createServiceClient(baseUrl: string, token: string): ServiceClient {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const req = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new Error(`Gander service unreachable at ${baseUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new Error(`Gander service ${res.status} on ${method} ${path}: ${await res.text()}`);
    return res.json();
  };
  const enc = encodeURIComponent;
  return {
    getReview: (repoId, prNumber) => req("GET", `/api/reviews/${enc(repoId)}/${prNumber}`) as Promise<ReviewState>,
    putFileState: (repoId, prNumber, input) => req("PUT", `/api/reviews/${enc(repoId)}/${prNumber}/files`, input) as Promise<FileCheckoff>,
  };
}
```

- [ ] **Step 4: Implement the reviewer pipeline**

`packages/app/src/main/review.ts`:

```ts
import { createHash } from "node:crypto";
import type { FileCheckoff, PrFile, PrSummary, PrView } from "@gander/shared";
import type { GitEngine } from "./git.js";
import type { ServiceClient } from "./service-client.js";

export interface ReviewerDeps {
  git: GitEngine;
  service: ServiceClient;
  listPrs(repoId: string): Promise<PrSummary[]>;
  repoUrl(repoId: string): string;
  machine: string;
}
export interface Reviewer {
  openPr(repoId: string, prNumber: number): Promise<PrView>;
  setChecked(repoId: string, prNumber: number, path: string, checked: boolean): Promise<PrView>;
}

const sha256 = (s: string | null): string | null =>
  s === null ? null : createHash("sha256").update(s).digest("hex");

export function createReviewer(deps: ReviewerDeps): Reviewer {
  async function openPr(repoId: string, prNumber: number): Promise<PrView> {
    const pr = (await deps.listPrs(repoId)).find((p) => p.number === prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not open on ${repoId}`);

    const clone = await deps.git.ensureClone(repoId, deps.repoUrl(repoId));
    await deps.git.fetchPr(clone, prNumber, pr.baseRef);
    const head = await deps.git.resolveRef(clone, `refs/gander/pr/${prNumber}`);
    const base = await deps.git.resolveRef(clone, `refs/gander/base/${pr.baseRef}`);
    const mergeBase = await deps.git.mergeBase(clone, base, head);
    const changed = await deps.git.diffFiles(clone, mergeBase, head);

    const state = await deps.service.getReview(repoId, prNumber);
    const byPath = new Map<string, FileCheckoff>(state.files.map((f) => [f.path, f]));

    const files: PrFile[] = [];
    for (const { path, status } of changed) {
      const baseContent = await deps.git.showFile(clone, mergeBase, path);
      const headContent = await deps.git.showFile(clone, head, path);
      const baseHash = sha256(baseContent);
      const headHash = sha256(headContent);
      const stored = byPath.get(path);
      const stillValid = stored?.checked === true && stored.baseHash === baseHash && stored.headHash === headHash;
      const changedSince = stored?.checked === true && !stillValid;
      if (changedSince) {
        await deps.service.putFileState(repoId, prNumber, { checked: false, path });
      }
      files.push({ path, status, baseContent, headContent, baseHash, headHash, checked: stillValid === true, changedSince: changedSince === true });
    }
    return { pr, files };
  }

  return {
    openPr,
    async setChecked(repoId, prNumber, path, checked) {
      if (checked) {
        const view = await openPr(repoId, prNumber);
        const file = view.files.find((f) => f.path === path);
        if (!file) throw new Error(`${path} is not part of PR #${prNumber}`);
        await deps.service.putFileState(repoId, prNumber, {
          checked: true, path,
          baseHash: file.baseHash, headHash: file.headHash,
          baseContent: file.baseContent, headContent: file.headContent,
          machine: deps.machine,
        });
      } else {
        await deps.service.putFileState(repoId, prNumber, { checked: false, path });
      }
      return openPr(repoId, prNumber);
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/app/src/main/review.test.ts`
Expected: PASS — including the force-push case (b.rb stays checked, a.rb un-checks with `changedSince`).

- [ ] **Step 6: Wire the real IPC handlers**

Replace the loop of not-implemented handlers in `packages/app/src/main/index.ts`:

```ts
import { app, BrowserWindow, ipcMain } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { repoIdFromUrl, type RepoEntry } from "@gander/shared";
import { loadConfig, saveConfig } from "./config.js";
import { createGitEngine } from "./git.js";
import { listOpenPrs, resolveGithubToken } from "./github.js";
import { createReviewer } from "./review.js";
import { createServiceClient } from "./service-client.js";

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const ghToken = await resolveGithubToken(cfg.githubToken);
  const git = createGitEngine(join(app.getPath("userData"), "clones"));
  const service = createServiceClient(cfg.serviceUrl, cfg.serviceToken);
  const urlFor = (repoId: string): string => {
    const entry = cfg.repos.find((r) => r.repoId === repoId);
    if (!entry) throw new Error(`Repo ${repoId} is not registered`);
    return entry.url;
  };
  const reviewer = createReviewer({
    git, service,
    listPrs: (repoId) => listOpenPrs(repoId, ghToken),
    repoUrl: urlFor,
    machine: hostname(),
  });

  ipcMain.handle("gander:listRepos", async () => cfg.repos);
  ipcMain.handle("gander:addRepo", async (_e, url: string): Promise<RepoEntry> => {
    const entry = { repoId: repoIdFromUrl(url), url };
    if (!cfg.repos.some((r) => r.repoId === entry.repoId)) { cfg.repos.push(entry); saveConfig(cfg); }
    return entry;
  });
  ipcMain.handle("gander:listPrs", async (_e, repoId: string) => listOpenPrs(repoId, ghToken));
  ipcMain.handle("gander:openPr", async (_e, repoId: string, n: number) => reviewer.openPr(repoId, n));
  ipcMain.handle("gander:refreshPr", async (_e, repoId: string, n: number) => reviewer.openPr(repoId, n));
  ipcMain.handle("gander:setChecked", async (_e, repoId: string, n: number, path: string, checked: boolean) => reviewer.setChecked(repoId, n, path, checked));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360, height: 860,
    backgroundColor: "#16181d",
    webPreferences: { preload: join(import.meta.dirname, "../preload/index.mjs") },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => { await bootstrap(); createWindow(); });
app.on("window-all-closed", () => app.quit());
```

- [ ] **Step 7: Run the whole suite**

Run: `pnpm test`
Expected: PASS across shared, service, and app packages.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(app): review pipeline with content-based un-check, wired to IPC"
```

---

### Task 8: Renderer shell — segmented header, dropdowns, store

**Files:**
- Create: `packages/app/src/renderer/src/store.ts`, `packages/app/src/renderer/src/components/TopBar.vue`, `packages/app/src/renderer/src/components/SwitcherDropdown.vue`, `packages/app/src/renderer/src/theme.css`
- Modify: `packages/app/src/renderer/src/App.vue`
- Test: `packages/app/src/renderer/src/store.test.ts`

**Interfaces:**
- Consumes: `GanderApi` via `api` (Task 4), `PrSummary`/`PrView`/`RepoEntry` from shared.
- Produces:
  - `createStore(api: GanderApi)` returning a reactive store used by all later renderer tasks:
    `interface Store { repos: RepoEntry[]; prs: PrSummary[]; currentRepoId: string | null; view: PrView | null; selectedPath: string | null; error: string | null; loadRepos(): Promise<void>; addRepo(url: string): Promise<void>; selectRepo(repoId: string): Promise<void>; openPr(prNumber: number): Promise<void>; refresh(): Promise<void>; setChecked(path: string, checked: boolean): Promise<void>; select(path: string): void; progress(): { done: number; total: number }; }`
  - Every store action catches errors into `store.error` (string, shown by the UI) — never swallowed.
  - `theme.css` defines the mockup's palette as CSS custom properties (`--bg: #16181d` etc., copied from `docs/mockups/mockup-v4.html`).

- [ ] **Step 1: Write the failing store tests (fake `GanderApi`, jsdom not required)**

`packages/app/src/renderer/src/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PrView } from "@gander/shared";
import type { GanderApi } from "./api.js";
import { createStore } from "./store.js";

const prView = (checkedPaths: string[] = []): PrView => ({
  pr: { number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headSha: "b" },
  files: [
    { path: "a.rb", status: "M", baseContent: "o", headContent: "n", baseHash: "b1", headHash: "h1", checked: checkedPaths.includes("a.rb"), changedSince: false },
    { path: "b.rb", status: "A", baseContent: null, headContent: "x", baseHash: null, headHash: "h2", checked: checkedPaths.includes("b.rb"), changedSince: false },
  ],
});

function fakeApi(overrides: Partial<GanderApi> = {}): GanderApi {
  return {
    listRepos: async () => [{ repoId: "acme/atlas", url: "u" }],
    addRepo: async (url) => ({ repoId: "acme/new", url }),
    listPrs: async () => [{ number: 1, title: "T", body: "", draft: false, baseRef: "main", baseSha: "a", headSha: "b" }],
    openPr: async () => prView(),
    setChecked: async (_r, _n, path) => prView([path]),
    refreshPr: async () => prView(),
    ...overrides,
  };
}

describe("store", () => {
  it("loads repos, selects one, opens a PR, tracks progress", async () => {
    const store = createStore(fakeApi());
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    expect(store.prs).toHaveLength(1);
    await store.openPr(1);
    expect(store.view?.files).toHaveLength(2);
    expect(store.progress()).toEqual({ done: 0, total: 2 });
    await store.setChecked("a.rb", true);
    expect(store.progress()).toEqual({ done: 1, total: 2 });
  });

  it("captures errors into store.error instead of throwing", async () => {
    const store = createStore(fakeApi({ listPrs: async () => { throw new Error("GitHub API 403: rate limited"); } }));
    await store.loadRepos();
    await store.selectRepo("acme/atlas");
    expect(store.error).toMatch(/403/);
  });

  it("clears error on the next successful action", async () => {
    let fail = true;
    const store = createStore(fakeApi({ listPrs: async () => { if (fail) throw new Error("boom"); return []; } }));
    await store.selectRepo("acme/atlas");
    expect(store.error).toMatch(/boom/);
    fail = false;
    await store.selectRepo("acme/atlas");
    expect(store.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/app/src/renderer`
Expected: FAIL — `store.js` does not exist.

- [ ] **Step 3: Implement the store**

`packages/app/src/renderer/src/store.ts`:

```ts
import { reactive } from "vue";
import type { PrSummary, PrView, RepoEntry } from "@gander/shared";
import type { GanderApi } from "./api.js";

export interface Store {
  repos: RepoEntry[]; prs: PrSummary[];
  currentRepoId: string | null; view: PrView | null;
  selectedPath: string | null; error: string | null;
  loadRepos(): Promise<void>; addRepo(url: string): Promise<void>;
  selectRepo(repoId: string): Promise<void>; openPr(prNumber: number): Promise<void>;
  refresh(): Promise<void>; setChecked(path: string, checked: boolean): Promise<void>;
  select(path: string): void; progress(): { done: number; total: number };
}

export function createStore(api: GanderApi): Store {
  const store: Store = reactive({
    repos: [], prs: [], currentRepoId: null, view: null, selectedPath: null, error: null,

    async loadRepos() { await guard(async () => { store.repos = await api.listRepos(); }); },
    async addRepo(url: string) {
      await guard(async () => { await api.addRepo(url); store.repos = await api.listRepos(); });
    },
    async selectRepo(repoId: string) {
      await guard(async () => {
        store.prs = await api.listPrs(repoId);
        store.currentRepoId = repoId; store.view = null; store.selectedPath = null;
      });
    },
    async openPr(prNumber: number) {
      await guard(async () => {
        if (!store.currentRepoId) throw new Error("no repo selected");
        store.view = await api.openPr(store.currentRepoId, prNumber);
        store.selectedPath = store.view.files[0]?.path ?? null;
      });
    },
    async refresh() {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) return;
        store.view = await api.refreshPr(store.currentRepoId, store.view.pr.number);
      });
    },
    async setChecked(path: string, checked: boolean) {
      await guard(async () => {
        if (!store.currentRepoId || !store.view) throw new Error("no PR open");
        store.view = await api.setChecked(store.currentRepoId, store.view.pr.number, path, checked);
      });
    },
    select(path: string) { store.selectedPath = path; },
    progress() {
      const files = store.view?.files ?? [];
      return { done: files.filter((f) => f.checked).length, total: files.length };
    },
  });

  async function guard(fn: () => Promise<void>): Promise<void> {
    try { await fn(); store.error = null; }
    catch (err) { store.error = (err as Error).message; }
  }
  return store;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/app/src/renderer`
Expected: PASS.

- [ ] **Step 5: Build the shell components**

`packages/app/src/renderer/src/theme.css` — copy the `:root` custom-property block verbatim from `docs/mockups/mockup-v4.html` (the `--bg` through `--mono` definitions), plus the base `body` font/background rules.

`packages/app/src/renderer/src/components/SwitcherDropdown.vue`:

```vue
<script setup lang="ts">
defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="veil" @click="emit('close')" />
    <div v-if="open" class="dd"><slot /></div>
  </Teleport>
</template>

<style scoped>
.veil { position: fixed; inset: 0; z-index: 30; }
.dd { position: fixed; top: 51px; background: var(--panel); border: 1px solid var(--border); border-radius: 0 0 12px 12px; box-shadow: 0 20px 50px rgba(0,0,0,.5); max-height: 65vh; overflow: auto; z-index: 31; min-width: 320px; }
</style>
```

`packages/app/src/renderer/src/components/TopBar.vue` — the segmented header from mockup v4: Repository segment (dropdown lists `store.repos`, item click → `store.selectRepo`; an "Add repository…" row with a URL input calling `store.addRepo`), Reviewing segment (dropdown lists `store.prs` with draft/open dot + title + number, click → `store.openPr`), progress pill bound to `store.progress()`. Styling copied from the mockup's `.seg`, `.lbl`, `.val`, `.chip`, `.sw-item` rules. Props: `{ store: Store }`.

`packages/app/src/renderer/src/App.vue`:

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { api } from "./api.js";
import { createStore } from "./store.js";
import TopBar from "./components/TopBar.vue";
import "./theme.css";

const store = createStore(api);
onMounted(() => store.loadRepos());
</script>

<template>
  <div class="app">
    <TopBar :store="store" />
    <div v-if="store.error" class="error-banner">{{ store.error }}</div>
    <main class="body">
      <p v-if="!store.view" class="empty">Pick a repository, then a pull request.</p>
    </main>
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: 50px 1fr; height: 100vh; }
.error-banner { background: rgba(248,81,73,.12); color: var(--red); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--border); }
.empty { color: var(--faint); padding: 2rem; }
</style>
```

- [ ] **Step 6: Manual smoke**

Run the service (`GANDER_TOKEN=devtoken GANDER_DB=/tmp/gander-dev.db pnpm --filter @gander/service dev`), write `~/.config/gander/config.json` with `{ "serviceUrl": "http://127.0.0.1:8390", "serviceToken": "devtoken", "repos": [] }`, then `pnpm --filter @gander/app dev`.
Expected: header renders; adding a real GitHub repo URL lists it; selecting it lists its open PRs; errors (bad URL, service down) appear in the banner.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): store, segmented header, repo/PR switchers"
```

---

### Task 9: File tree with tri-state directory checkoff

**Files:**
- Create: `packages/app/src/renderer/src/tree.ts`, `packages/app/src/renderer/src/components/FileTree.vue`
- Modify: `packages/app/src/renderer/src/App.vue` (mount the tree pane)
- Test: `packages/app/src/renderer/src/tree.test.ts`

**Interfaces:**
- Consumes: `PrFile` from shared; `Store` (Task 8).
- Produces:
  - `buildTree(files: PrFile[]): TreeNode[]` with `type TreeNode = { type: "dir"; name: string; path: string; children: TreeNode[] } | { type: "file"; file: PrFile }` — sorted (dirs first, then files, both alphabetical), single-child directory chains compacted into one node whose `name` joins segments with `/`.
  - `dirState(node: TreeNode & { type: "dir" }): "all" | "some" | "none"` — over descendant files' `checked`.
  - `filesUnder(node: TreeNode): PrFile[]` — flat descendant files (used for directory checkoff).
  - `FileTree.vue` props `{ store: Store }`; clicking a file selects it; file checkbox → `store.setChecked(path, !checked)`; directory checkbox → check all descendants if any unchecked, else un-check all (sequential `store.setChecked` calls); yellow ● on `changedSince` files.

- [ ] **Step 1: Write the failing tree-logic tests**

`packages/app/src/renderer/src/tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PrFile } from "@gander/shared";
import { buildTree, dirState, filesUnder } from "./tree.js";

const file = (path: string, checked = false): PrFile =>
  ({ path, status: "M", baseContent: "", headContent: "", baseHash: "b", headHash: "h", checked, changedSince: false });

describe("buildTree", () => {
  it("nests by directory and compacts single-child chains", () => {
    const tree = buildTree([
      file("app/models/member.rb"),
      file("app/services/dues/late_fee_calculator.rb"),
      file("config/routes.rb"),
    ]);
    expect(tree.map((n) => (n.type === "dir" ? n.name : n.file.path))).toEqual(["app", "config"]);
    const app = tree[0]!;
    if (app.type !== "dir") throw new Error("expected dir");
    // chains compacted: "models" and "services/dues"
    expect(app.children.map((c) => (c.type === "dir" ? c.name : ""))).toEqual(["models", "services/dues"]);
    const config = tree[1]!;
    if (config.type !== "dir") throw new Error("expected dir");
    expect(config.children[0]).toMatchObject({ type: "file", file: { path: "config/routes.rb" } });
  });

  it("sorts directories before files, both alphabetically", () => {
    const tree = buildTree([file("zz.rb"), file("app/a.rb"), file("aa.rb")]);
    expect(tree.map((n) => (n.type === "dir" ? `d:${n.name}` : `f:${n.file.path}`))).toEqual(["d:app", "f:aa.rb", "f:zz.rb"]);
  });
});

describe("dirState / filesUnder", () => {
  it("computes none/some/all from descendants", () => {
    const mk = (aChecked: boolean, bChecked: boolean) => {
      const tree = buildTree([file("app/a.rb", aChecked), file("app/b/c.rb", bChecked)]);
      const app = tree[0]!;
      if (app.type !== "dir") throw new Error("expected dir");
      return app;
    };
    expect(dirState(mk(false, false))).toBe("none");
    expect(dirState(mk(true, false))).toBe("some");
    expect(dirState(mk(true, true))).toBe("all");
    expect(filesUnder(mk(true, false)).map((f) => f.path)).toEqual(["app/b/c.rb", "app/a.rb"].sort() as string[]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/app/src/renderer/src/tree.test.ts`
Expected: FAIL — `tree.js` does not exist.

- [ ] **Step 3: Implement the tree logic**

`packages/app/src/renderer/src/tree.ts`:

```ts
import type { PrFile } from "@gander/shared";

export type TreeNode =
  | { type: "dir"; name: string; path: string; children: TreeNode[] }
  | { type: "file"; file: PrFile };

interface MutableDir { dirs: Map<string, MutableDir>; files: PrFile[]; }

export function buildTree(files: PrFile[]): TreeNode[] {
  const root: MutableDir = { dirs: new Map(), files: [] };
  for (const f of files) {
    const segments = f.path.split("/");
    let node = root;
    for (const seg of segments.slice(0, -1)) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg)!;
    }
    node.files.push(f);
  }

  const emit = (dir: MutableDir, prefix: string): TreeNode[] => {
    const dirNodes: TreeNode[] = [...dir.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        // compact single-child chains with no direct files
        let compactName = name;
        let compactChild = child;
        let compactPrefix = prefix ? `${prefix}/${name}` : name;
        while (compactChild.files.length === 0 && compactChild.dirs.size === 1) {
          const [nextName, nextChild] = [...compactChild.dirs.entries()][0]!;
          compactName = `${compactName}/${nextName}`;
          compactPrefix = `${compactPrefix}/${nextName}`;
          compactChild = nextChild;
        }
        return { type: "dir" as const, name: compactName, path: compactPrefix, children: emit(compactChild, compactPrefix) };
      });
    const fileNodes: TreeNode[] = dir.files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => ({ type: "file" as const, file }));
    return [...dirNodes, ...fileNodes];
  };
  return emit(root, "");
}

export function filesUnder(node: TreeNode): PrFile[] {
  if (node.type === "file") return [node.file];
  return node.children.flatMap(filesUnder).sort((a, b) => a.path.localeCompare(b.path));
}

export function dirState(node: TreeNode & { type: "dir" }): "all" | "some" | "none" {
  const files = filesUnder(node);
  const done = files.filter((f) => f.checked).length;
  return done === 0 ? "none" : done === files.length ? "all" : "some";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/app/src/renderer/src/tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the component and mount it**

`packages/app/src/renderer/src/components/FileTree.vue` — recursive template over `buildTree(store.view.files)`: directory rows with chevron (local collapsed-state `Set<string>` keyed by `node.path`), tri-state checkbox rendering `✓`/`–` per `dirState`, click → check/un-check `filesUnder(node)` via sequential `store.setChecked`; file rows with checkbox, name, yellow ● when `changedSince`, status letter (M/A/D/R colored per mockup), click → `store.select(file.path)`; selected row highlighted. Styling copied from mockup v4's `.tnode`, `.cb`, `.chev`, `.st` rules.

In `App.vue`, replace the `main.body` block:

```vue
<main class="body">
  <p v-if="!store.view" class="empty">Pick a repository, then a pull request.</p>
  <template v-else>
    <FileTree :store="store" class="tree" />
    <section class="diff-placeholder">{{ store.selectedPath }}</section>
  </template>
</main>
```

with `.body { display: grid; grid-template-columns: 264px 1fr; min-height: 0; }`.

- [ ] **Step 6: Manual smoke**

With service + app running against a real repo PR: tree renders nested with compact chains; checking a directory checks all files beneath it; progress pill updates.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): file tree with compacted chains and tri-state checkoff"
```

---

### Task 10: Monaco unified diff pane

**Files:**
- Create: `packages/app/src/renderer/src/components/DiffPane.vue`, `packages/app/src/renderer/src/monaco.ts`
- Modify: `packages/app/src/renderer/src/App.vue` (replace `.diff-placeholder`)
- Test: `packages/app/src/renderer/src/monaco.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 8), `PrFile` from shared.
- Produces:
  - `monaco.ts`: `setupMonacoWorkers(): void` (Vite worker wiring) and `languageForPath(path: string): string` (extension → Monaco language id; unknown → `"plaintext"`).
  - `DiffPane.vue` props `{ store: Store }`: file header (dimmed dirname + filename), tabs **vs main** / **full file**, "Mark reviewed" button mirroring the tree checkbox, Monaco diff editor with `renderSideBySide: false`, `readOnly: true`, `automaticLayout: true`, `hideUnchangedRegions: { enabled: true }`. The **since my ✓** tab from the mockup arrives in M2 and is not rendered in M1.

- [ ] **Step 1: Write the failing language-map test**

`packages/app/src/renderer/src/monaco.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { languageForPath } from "./monaco.js";

describe("languageForPath", () => {
  it("maps common extensions", () => {
    expect(languageForPath("app/models/member.rb")).toBe("ruby");
    expect(languageForPath("src/App.vue")).toBe("html");
    expect(languageForPath("src/main.ts")).toBe("typescript");
    expect(languageForPath("a/b.js")).toBe("javascript");
    expect(languageForPath("x.json")).toBe("json");
    expect(languageForPath("y.md")).toBe("markdown");
    expect(languageForPath("z.py")).toBe("python");
    expect(languageForPath("style.css")).toBe("css");
    expect(languageForPath("index.html")).toBe("html");
    expect(languageForPath("script.sh")).toBe("shell");
    expect(languageForPath("main.go")).toBe("go");
    expect(languageForPath("lib.rs")).toBe("rust");
  });
  it("falls back to plaintext", () => {
    expect(languageForPath("LICENSE")).toBe("plaintext");
    expect(languageForPath("data.unknownext")).toBe("plaintext");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/app/src/renderer/src/monaco.test.ts`
Expected: FAIL — `monaco.js` does not exist.

- [ ] **Step 3: Implement the Monaco helper**

`packages/app/src/renderer/src/monaco.ts`:

```ts
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

export function setupMonacoWorkers(): void {
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
}

const EXT_TO_LANG: Record<string, string> = {
  rb: "ruby", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  vue: "html", html: "html", css: "css", scss: "scss", json: "json", md: "markdown",
  py: "python", sh: "shell", bash: "shell", go: "go", rs: "rust", yml: "yaml", yaml: "yaml",
  sql: "sql", xml: "xml", toml: "ini",
};

export function languageForPath(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  return EXT_TO_LANG[base.slice(dot + 1).toLowerCase()] ?? "plaintext";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/app/src/renderer/src/monaco.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the diff pane**

`packages/app/src/renderer/src/components/DiffPane.vue`:

```vue
<script setup lang="ts">
import * as monaco from "monaco-editor";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { languageForPath, setupMonacoWorkers } from "../monaco.js";
import type { Store } from "../store.js";

const props = defineProps<{ store: Store }>();
const host = ref<HTMLElement | null>(null);
const view = ref<"diff" | "full">("diff");
let editor: monaco.editor.IStandaloneDiffEditor | monaco.editor.IStandaloneCodeEditor | null = null;

const current = computed(() =>
  props.store.view?.files.find((f) => f.path === props.store.selectedPath) ?? null);

function dispose(): void { editor?.dispose(); editor = null; }

function render(): void {
  dispose();
  const file = current.value;
  if (!host.value || !file) return;
  const lang = languageForPath(file.path);
  if (view.value === "diff") {
    const diff = monaco.editor.createDiffEditor(host.value, {
      renderSideBySide: false, readOnly: true, automaticLayout: true,
      hideUnchangedRegions: { enabled: true }, theme: "vs-dark",
    });
    diff.setModel({
      original: monaco.editor.createModel(file.baseContent ?? "", lang),
      modified: monaco.editor.createModel(file.headContent ?? "", lang),
    });
    editor = diff;
  } else {
    editor = monaco.editor.create(host.value, {
      value: file.headContent ?? "", language: lang,
      readOnly: true, automaticLayout: true, theme: "vs-dark",
    });
  }
}

onMounted(() => { setupMonacoWorkers(); render(); });
watch([current, view], render);
onBeforeUnmount(dispose);
</script>

<template>
  <section class="pane" v-if="current">
    <header class="filehead">
      <span class="path">{{ current.path }}</span>
      <div class="tabs">
        <button :class="{ active: view === 'diff' }" @click="view = 'diff'">vs main</button>
        <button :class="{ active: view === 'full' }" @click="view = 'full'">full file</button>
      </div>
      <button class="check" :class="{ on: current.checked }"
        @click="store.setChecked(current.path, !current.checked)">
        {{ current.checked ? "✓ Reviewed" : "Mark reviewed" }}
      </button>
    </header>
    <div ref="host" class="editor" />
  </section>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; min-width: 0; }
.filehead { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--panel); }
.path { font-family: var(--mono); font-size: 12.5px; }
.tabs { margin-left: auto; display: flex; gap: 2px; }
.tabs button { background: none; border: none; color: var(--dim); font-size: 11.5px; padding: 3px 10px; border-radius: 5px; cursor: pointer; }
.tabs button.active { background: #2c3340; color: var(--text); }
.check { border: 1px solid var(--border); background: #22262e; color: var(--text); border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
.check.on { border-color: var(--green); color: var(--green); background: rgba(63,185,80,.15); }
.editor { flex: 1; min-height: 0; }
</style>
```

In `App.vue`, replace `<section class="diff-placeholder">…</section>` with `<DiffPane :store="store" />` (import it).

- [ ] **Step 6: Manual smoke**

Open a real PR: unified diff renders with word-level highlights and folded unchanged regions; "full file" tab shows the whole head-side file; "Mark reviewed" flips both the button and the tree checkbox.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): unified Monaco diff pane with full-file tab"
```

---

### Task 11: Live refresh + changed-since surfacing

**Files:**
- Modify: `packages/app/src/renderer/src/App.vue` (polling + focus refresh), `packages/app/src/renderer/src/components/DiffPane.vue` (changed-since banner)
- Test: `packages/app/src/renderer/src/store.test.ts` (extend)

**Interfaces:**
- Consumes: `Store.refresh()` (Task 8), `PrFile.changedSince` (Task 7).
- Produces: the M1 exit criteria — a PR under active development stays truthful on screen without manual reloads.

- [ ] **Step 1: Extend the store test for refresh preserving selection**

Append to `packages/app/src/renderer/src/store.test.ts`:

```ts
it("refresh replaces the view but keeps the selected path", async () => {
  const store = createStore(fakeApi());
  await store.loadRepos();
  await store.selectRepo("acme/atlas");
  await store.openPr(1);
  store.select("b.rb");
  await store.refresh();
  expect(store.selectedPath).toBe("b.rb");
  expect(store.view).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it passes (or fix `refresh` if it clobbers selection)**

Run: `pnpm vitest run packages/app/src/renderer/src/store.test.ts`
Expected: PASS — `refresh()` as written does not touch `selectedPath`. If it fails, fix `refresh()` to preserve it, not the test.

- [ ] **Step 3: Wire polling and focus refresh**

In `App.vue`'s `<script setup>`:

```ts
import { onBeforeUnmount } from "vue";

const POLL_MS = 30_000;
const timer = setInterval(() => store.refresh(), POLL_MS);
const onFocus = (): void => { void store.refresh(); };
window.addEventListener("focus", onFocus);
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener("focus", onFocus); });
```

- [ ] **Step 4: Add the changed-since banner to DiffPane**

Inside the `<section class="pane">`, directly under `<header>`:

```vue
<div v-if="current.changedSince" class="banner">
  ⚠ Changed since your review — un-checked automatically. Re-review and mark again.
</div>
```

```css
.banner { background: rgba(210,153,34,.08); color: var(--yellow); padding: 7px 14px; font-size: 12px; border-bottom: 1px solid var(--border); }
```

- [ ] **Step 5: Full-suite run and end-to-end manual verification**

Run: `pnpm test && pnpm typecheck`
Expected: all green.

Manual (the M1 acceptance walk): service running → app open → add repo → open a PR → check two files → push a new commit to the PR branch touching one of them → within 30s (or on refocus) that file un-checks with the yellow banner, the other stays checked, progress pill updates.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(renderer): polling refresh and changed-since banner — M1 complete"
```

---

## Self-Review

**Spec coverage (M1 slice):** repo registration (T7/T8), PR listing with draft badge data (T6/T8), app-managed bare clones + real git (T5), PR diff base→head (T5/T7), content-based checkoff with snapshot storage and retained-on-uncheck delta base (T2/T7), tri-state tree (T9), unified Monaco diff + full-file view (T10), polling/focus refresh + loud errors (T8/T11), bearer-auth service bound to localhost by default (T3). Deferred with their plans: questions/MCP/delta view (M2), local viewer + untracked handling (M3), packaging/CI/read cache/PR description panel + keyboard map + drawer (M2/M4).

**Known deviations from the full spec, deliberate for M1:** PR description panel, ⌘K, j/k/space/n keys, and the questions drawer ship with M2 alongside the drawer they belong to; Playwright smoke ships with packaging in M4.

**Type consistency:** `PrFile`/`PrView`/`PrSummary`/`FileCheckoff`/`PutFileState` defined once in Task 1 and imported everywhere; IPC channel names fixed in Task 4 and reused in Task 7; `Store` shape fixed in Task 8 and consumed in Tasks 9–11.
