# Improvement plans

Audit run 2026-08-19 against `a129029`, re-verified and executed against `b8be583`.
Baseline both times: `pnpm typecheck` clean, `pnpm test` green.

Everything below was confirmed by reading the code, not inferred. Findings that
did not survive that check are in "Considered and rejected" so they don't get
re-audited.

## Already fixed

| Finding | Landed as |
|---|---|
| `diffFiles` dropped a rename's base path and parsed without `-z`, so moved files read as wholly added and non-ASCII names rendered blank — both silently | `f348538` |
| Removed e2e suite left two docs promising `pnpm test:e2e`, seven devDeps, and a chromedriver check that could fail `pnpm install` for the whole workspace | `92b5431` |
| "Could not reach" built in three places and regex-matched in a fourth; rewording it failed no test | `4bca104` |
| `lucide-vue-next` deprecated at its own latest version | `b8be583` |

## Open

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Batch the per-file blob reads through one `git cat-file --batch` | P2 | M | — | TODO |
| 002 | Make the main-process IPC handlers testable, and test them | P2 | M | — | TODO |
| 003 | Upgrade Electron 33 → 43 and delete the repair workaround | P3 | L | 002 | TODO |

Unplanned but recorded, in rough leverage order:

- **`sandbox: false`** (`main/index.ts:291-299`). Forced only because the preload is
  emitted as ESM, and a sandboxed preload cannot load ESM. The preload itself
  (`preload/index.ts`) uses nothing but `contextBridge` and `ipcRenderer`, both
  available under the sandbox — emitting it as CJS would restore the sandbox. Matters
  because the renderer displays arbitrary repository content. S–M effort; the risk is
  that electron-vite's preload output format and the `.mjs` filename both have to move
  together, and getting it wrong means `window.gander` is silently undefined.
- **`App.vue` command dispatch is untested** (`:257-344`, `:364-383`). 14-branch
  `runCommand`, the bulk directory-checkoff rule in `mark`, and the `isTyping` gate
  that stops single-letter bindings firing inside the note input. `keymap.ts` and
  `tree-nav.ts` were already pulled out of this file for exactly this reason; the same
  move for `runCommand`/`mark` would make them testable against the existing fake-api
  store.
- **`DiffPane.vue`'s `renderKey`** (`:175-205`). A 20-line comment reasons out five
  cases; nothing verifies any of them, and the key is not exported. Getting it wrong
  resets scroll and folds mid-read. Lifting it to an exported pure function makes the
  comment its own test plan. S effort.
- **`store.ts` is a god module** (518 lines, four hand-rolled concurrency counters).
  The ~200-line local/Explorer half is separable. Maintainability only — coverage there
  is genuinely good, so this is not urgent.
- **Two TypeScript majors in one workspace.** Root is `^7.0.2`; `packages/app` pins
  `5.9.3` and typechecks with `vue-tsc`, so the largest package never sees TS 7.
  `@types/node` is `^22` in the app and `^26` in the service while `mise.toml` pins Node
  24. Align `@types/node` first — that half is safe and independent. Whether the TS pin
  is a `vue-tsc` constraint or drift needs checking before touching it; if it is a
  constraint, leave a comment at the pin saying so.
- **No smoke test on the packaged build** (issue #91). Nothing exercises preload
  wiring, IPC channel registration, or packaged boot. Plan 003 is materially riskier
  without one.

## Direction

Options, not defects — for the maintainer to weigh.

- **Reviewer-triggered delivery ("ping").** Already named as the next capability worth
  adding once dogfooding demands it: an explicit "work on this one next" / "I finished
  a pass, go triage", not push infrastructure. Deliberately bounded against the wake
  bridges and reply threads that were built and abandoned.
- **`addressed` notes are invisible until you open the PR that holds them.** The
  lifecycle assumes the reviewer returns to resolve, but `PrListItem` carries
  `reviewProgress` and no note counts, so an agent finishing work produces no signal in
  the PR list or across repositories. Agents got a pull mechanism; the reviewer got
  nothing. The obvious fix is a badge, and badges lean toward the notification model
  that was deliberately walked back — worth thinking about before building.
- **Vanished-PR archive is spec drift, not a feature gap.** The design spec commits to
  it under error handling; there is no code, and `fetchHead` in `review.ts` simply
  throws `PR #N not open`. Either implement it or amend the spec — right now the spec
  is wrong.

## Considered and rejected

- **Monaco code-splitting** — the renderer bundle loads from local disk in the packaged
  app, so there is no download cost, and `monaco.ts` already puts the worker off-thread.
- **SQLite indexes** — `UNIQUE(repo_id, pr_number)` and `UNIQUE(review_id, path)` are
  exactly what the queries key on, plus an explicit `notes_by_review`. `findPrByHeadRef`
  scans unindexed over one row per PR ever opened. Not worth it.
- **Renderer re-render cost** — `FileTree.vue:43-60` already memoizes both hot lookups;
  `store.ts`'s `find`/`some` calls run once per user action, not per row.
- **`.env.example`** — `bin/setup` generates `.env`; a checked-in example would be a
  second source of truth for machine-specific values.
- **Adding a linter or formatter** — deliberate omission, and no evidence of a bug class
  it would have caught. Two `any`/`as` escapes exist in the whole codebase, both the
  narrowest form available.
- **Service auth hook missing `return reply`** (`server.ts:44-48`) — looked like
  handlers might run despite a 401. Tested against Fastify 5.12: the lifecycle halts,
  the handler never executes. Not a bug.
- **`mark_note_addressed` takes an unscoped note id** — no repo/PR check, so an id could
  be marked across reviews. Under a single shared bearer token every caller is equally
  trusted, so this is not a privilege boundary.
- **Circular dependencies / layering violations** — none. `shared → service/app` holds,
  and the renderer reaches main only through the preload bridge.
