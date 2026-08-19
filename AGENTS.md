# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` is a symlink
to this file, so Claude Code, Codex, and Gemini CLI all read the same text.

## What Gander is

A desktop app for reviewing code in the agentic era: agents write the code, the
human reviews it. One window over every repo and pull request, a Monaco diff,
hierarchical file checkoff, and a note pipeline that carries the reviewer's
remarks to coding agents over MCP.

`docs/deploy.md` covers running the service on a host.

**This repository is public, so everything specific to the maintainer's instance
lives outside it**, on the maintainer's machines at `~/src/backstage/gander/`.
Look there first for anything this repository does not answer — a host name, a
credential reference, a release step, the binding design.

| Path | Holds |
|---|---|
| `specs/` | The approved design spec. Binding. Read it before changing behaviour. |
| `infrastructure.md` | This deployment: host, path, container, volume, URL, proxy and DNS, the 1Password reference for the token, and per-machine setup |
| `releasing.md` | The release procedure and what the signing machine provides |
| `plans/`, `briefs/`, `mockups/` | Implementation plans, briefs, and the reference mockup |

`docs/STATE.md` says where the project stands. Interface work is tracked in GitHub
issues.

Settings are validated strictly, so a config written by an earlier version stops
the app from starting. While the shape is still settling there are no migrations:
`bin/fix-config` keeps the values the schema still knows, fills in the new ones,
and drops the rest.

`SERVICE_VERSION` in `@gander/shared` is the app-to-service contract version, and the
app checks it when it connects. **Bump it in the same change that alters the
contract** — a route added or removed, a field the app comes to rely on. Leaving it
alone lets a stale service answer "the version you wanted", and the mismatch surfaces
later as a 404 in the middle of a review.

`packages/service/contract.json` records that contract — routes, payload schemas, MCP
tools — and a test compares it against a running server, so a change fails until the
version moves. After changing the contract deliberately: bump `SERVICE_VERSION`, then
run `bin/contract-snapshot`. It refuses while the version is unchanged.

**The repo is public.** No client names, private repo names, or real PR numbers
in code, comments, commits, or issues.

## Commands

| Task | Command |
|------|---------|
| First run after a clone | `bin/setup` |
| Start service + app | `bin/dev` (`-D` headless, `stop`, `status`, `logs service`) |
| Start app against hosted service | `bin/dev --hosted` (add `-D` for headless) |
| Unit tests | `pnpm test` |
| One test file | `pnpm vitest run packages/service/src/storage.test.ts` |
| One test by name | `pnpm vitest run -t "un-check retains the snapshot"` |
| Typecheck (all packages) | `pnpm typecheck` |
| Open a review in the running app | `bin/gander --repo owner/name [--pr 42]` |
| Repair a config the settings schema has outgrown | `bin/fix-config` |
| Update the service on its host | `bin/deploy` (host and path in `~/src/backstage/gander/infrastructure.md`) |
| Re-record the contract after changing it | `bin/contract-snapshot` |
| Build an unsigned app | `pnpm --filter @gander/app run dist:unsigned` |
| Isolated working copy | `bin/worktree add <name>` |
| Check this worktree's MCP bridge | `bin/mcp check` |

There is no linter or formatter, and no CI. `pnpm typecheck` and `pnpm test` are
the gate.

`bin/dev` is process-compose supervising the service and the app, with ports
allocated per-checkout by outport. Don't start packages by hand — the app reads
its port and token from the generated `.env`. `DEVSTACK.md` covers the stack,
worktrees, and MCP registration.

When Steve asks to open the current PR in Gander, dogfood a change, or respond
to Gander review notes, read
`.agents/skills/review-with-gander/SKILL.md` and follow it. Use the CLI bridge
from the current worktree; do not register its MCP endpoint globally or reuse
another worktree's port, token, config, database, or process.

**Electron install trap:** Electron 33's extract-zip silently truncates under
Node 24, leaving a `node_modules/electron/dist` of a few hundred KB while the
install script exits 0. Electron then fails to launch. The root `postinstall` hook runs
`bin/repair-electron`, which detects this and re-runs only the Electron download
scripts under Node 22 via mise, so every `pnpm install` repairs itself. If the
binaries are broken anyway, run `bin/repair-electron` rather than debugging
them. Both the script and the hook come out when Electron is upgraded past the
broken extract-zip.

## Architecture

Three packages in a pnpm workspace, ESM-only, TypeScript strict with
`noUncheckedIndexedAccess`.

| Package | Owns |
|---|---|
| `@gander/shared` | Domain types as Zod schemas; both other packages validate against them |
| `@gander/service` | Fastify + better-sqlite3. Everything the *reviewer authors*: checkoffs, snapshot content, notes, PR context. Bearer auth. Hosts `/mcp`. |
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

**Keyboard** is one table: `renderer/src/keymap.ts` lists every binding, and both the
handler in `App.vue` and the `?` sheet read it, so a key cannot be added without the help
learning about it. `renderer/src/tree-nav.ts` holds the cursor, the collapse state, and the
row order, rather than `FileTree.vue`, which renders itself recursively — keyboard movement
needs one answer to what is visible. The cursor walks directories as well as files and is
separate from the selected file, because a directory has nothing to show in the diff:
passing over one leaves the reader on the file they were already reading.

**Note lifecycle:** `open` (reviewer captures with `n`) → `addressed` (agent,
over MCP, with optional commit ref and summary) → `resolved` (reviewer re-checks
the file). Resolution is always the reviewer's act; no MCP tool may resolve
anything. The MCP contract is deliberately two tools — `get_review_notes` and
`mark_note_addressed`. Agents discuss notes with the reviewer in their active
session; MCP carries the reviewer's notes and the durable completion state. Agents
have `git` and `gh` for code. Keep the contract small.

`GANDER_SERVICE_URL` and `GANDER_TOKEN` override the config file at *connection*
time, not load time (`resolveServiceConnection` in `main/config.ts`) — otherwise
saving config would write a machine-specific allocated port into
`.gander/config.json`.

App config is intentionally not backward-compatible while its shape remains in
major flux and there is only one maintainer install. Keep validation strict; when
Steve asks to repair a stale local config, update that file directly instead of
adding migrations or compatibility branches. Add explicit schema versions and
migrations only when backward compatibility becomes a product requirement.

`SCHEMA` in `storage.ts` is the only supported SQLite shape. There is no upgrade
path for databases created by an earlier build; recreate the sole user's database
after a schema change.

## Testing

Real dependencies, never mocks: real throwaway git repositories
(`main/fixtures.ts`), real SQLite files in temp dirs, real Fastify instances,
real MCP clients. `test/setup-git-env.ts` points git at an empty global and
system config, so a developer's own git settings cannot change what the suite
sees.

There is no end-to-end suite. The previous one drove the built app as a single
eleven-step session, so one broken step took the rest with it and every check
cost a full rebuild. Anything that replaces it starts each check from a clean
app.

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
