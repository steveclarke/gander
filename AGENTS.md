# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` is a symlink
to this file, so Claude Code, Codex, and Gemini CLI all read the same text.

## What Gander is

A desktop app for reviewing code in the agentic era: agents write the code, the
human reviews it. One window over every repo and pull request, a Monaco diff,
hierarchical file checkoff, and a question pipeline that carries the reviewer's
notes to coding agents over MCP.

`docs/superpowers/specs/2026-08-15-gander-design.md` is the approved, binding
design spec — read it before changing behaviour. `docs/STATE.md` says where the
project stands. Interface work and the agent reply channel are GitHub issues.

**The repo is public.** No client names, private repo names, or real PR numbers
in code, comments, commits, or issues.

## Commands

| Task | Command |
|------|---------|
| First run after a clone | `bin/setup` |
| Start service + app | `bin/dev` (`-D` headless, `stop`, `status`, `logs service`) |
| Unit tests | `pnpm test` |
| One test file | `pnpm vitest run packages/service/src/storage.test.ts` |
| One test by name | `pnpm vitest run -t "un-check retains the snapshot"` |
| Typecheck (all packages) | `pnpm typecheck` |
| Electron E2E | `pnpm test:e2e` |
| Isolated working copy | `bin/worktree add <name>` |

There is no linter or formatter, and no CI. `pnpm typecheck` and `pnpm test` are
the gate.

`bin/dev` is process-compose supervising the service and the app, with ports
allocated per-checkout by outport. Don't start packages by hand — the app reads
its port and token from the generated `.env`. `DEVSTACK.md` covers the stack,
worktrees, and MCP registration.

**Electron install trap:** Electron 33's extract-zip silently truncates under
Node 24, leaving a `node_modules/electron/dist` of a few hundred KB while the
install script exits 0. E2E then fails with `chromedriver ENOENT` or
`DevToolsActivePort file doesn't exist`. `bin/setup` detects this and re-runs
only the Electron download scripts under Node 22 via mise — rerun `bin/setup`
rather than debugging the binaries.

## Architecture

Three packages in a pnpm workspace, ESM-only, TypeScript strict with
`noUncheckedIndexedAccess`.

| Package | Owns |
|---|---|
| `@gander/shared` | Domain types as Zod schemas; both other packages validate against them |
| `@gander/service` | Fastify + better-sqlite3. Everything the *reviewer authors*: checkoffs, snapshot content, questions, PR context. Bearer auth. Hosts `/mcp`. |
| `@gander/app` | Electron main (git, GitHub, review orchestration) + Vue renderer. Everything *derived* from repos: clones, diffs, rendering. Read-only cache of review state. |

The service is the single source of truth for authored state; cross-machine
review is the topology, not a sync feature. The app never persists review state
of its own.

**Main process** (`packages/app/src/main/`): `git.ts` shells out to the real
`git` binary — never reimplement git; `github.ts` resolves the `gh` token and
lists PRs; `review.ts` is the orchestrator that joins git-derived files with
service state and caches the `PrView`; `index.ts` is IPC handlers plus the menu.
The renderer talks to main only through the preload bridge.

**Content-based review state** is the central invariant. A checkoff stores
sha256 hashes of both diff sides plus the snapshot text. A file stays checked
while its content matches, so rebases and force-pushes don't disturb a review;
when content genuinely changes the file un-checks and gains a "changed since"
marker, and the snapshot becomes the base for the delta diff. An un-check
deliberately *retains* the snapshot — absence of a snapshot means "never
reviewed", not "unchanged".

**Question lifecycle:** `open` (reviewer captures with `n`) → `addressed` (agent,
over MCP, with optional commit ref and note) → `resolved` (reviewer re-checks
the file). Resolution is always the reviewer's act; no MCP tool may resolve
anything. The MCP contract is deliberately two tools —
`get_review_questions` and `mark_question_addressed`. Agents have `git` and `gh`
for code; this contract carries only the reviewer's questions. Keep it small.

`GANDER_SERVICE_URL` and `GANDER_TOKEN` override the config file at *connection*
time, not load time (`resolveServiceConnection` in `main/config.ts`) — otherwise
saving config would write a machine-specific allocated port into
`.gander/config.json`.

SQLite schema changes go through `migrate()` in `storage.ts`:
`CREATE TABLE IF NOT EXISTS` silently does nothing to an existing table, so new
columns need `PRAGMA table_info` plus `ALTER TABLE ADD COLUMN`.

## Testing

Real dependencies, never mocks: real throwaway git repositories
(`main/fixtures.ts`), real SQLite files in temp dirs, real Fastify instances,
real MCP clients. The E2E suite builds the app and drives the Electron window
through WebDriverIO against an isolated service and a local GitHub fake — it
needs no GitHub credentials and does not touch the dev stack.

Bugs that reached a person get a test that fails without the fix; prove it by
reverting the fix.

## Conventions

- Comments explain *why*, especially where the code looks wrong without the
  reason (Monaco's hidden textarea, retained snapshots, connection-time config).
  Match that density; don't narrate what the code already says.
- Everything in the app is read-only. There is no editing feature and no GitHub
  review machinery (comments, approvals, merge) — that's out of scope by design.
- Errors surface: no silent degradation, no write queues, no swallowed git or
  GitHub error text.
- Icons come from `lucide-vue-next`. Panel sizes and docking live in
  localStorage (`renderer/src/layout.ts`); anything a second machine should see
  belongs in the service instead.
