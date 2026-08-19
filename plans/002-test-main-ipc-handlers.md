# Plan 002: Make the main-process IPC handlers testable, and test the local-worktree ones

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat b8be583..HEAD -- packages/app/src/main/index.ts packages/app/src/main/settings-ipc.ts`
> If either changed, compare the "Current state" excerpts below against the live
> code before proceeding. On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `b8be583`, 2026-08-19

## Why this matters

`packages/app/src/main/index.ts` holds 28 `ipcMain.handle` registrations and has no
test file. That is the entire contract between the renderer and the main process,
and none of it is verified.

Two pieces of real logic live only there. `requireOpenWorktree` is an authorization
check — the renderer names a worktree path on every local read, and only the one
this window actually has open may be read through. And the open-generation counter
discards a superseded `openLocal` so a slow open cannot clobber a newer one. The
matching race in the renderer half *is* tested (`store.test.ts` covers supersession);
the main-process half is not.

Because `ipcMain.handle` takes a channel name as a string, a renamed channel, a
dropped `requireOpenWorktree` call, or an inverted generation comparison produces no
typecheck error and no test failure. The only signal today is a human using the app.

## Current state

`index.ts` is untestable in its present shape because it imports `electron` at module
top level and registers handlers as a side effect of running.

The repo already solved this once, and that solution is the pattern to copy.
`packages/app/src/main/settings-ipc.ts` takes `ipcMain` as a parameter:

```ts
import type { IpcMain } from "electron";

type SettingsIpc = Pick<IpcMain, "handle">;

export function registerSettingsIpc(
  ipc: SettingsIpc,
  cfg: GanderConfig,
  persist: (config: GanderConfig) => void = saveConfig,
  onSettingsChanged: (settings: AppSettings) => void = () => {},
): void {
  ipc.handle("gander:getSettings", async () => cfg.settings);
  ...
}
```

and `settings-ipc.test.ts` drives it with a fake that just collects handlers:

```ts
const handlers = new Map<string, Handler>();
const ipc = {
  handle(channel: string, handler: Handler) { handlers.set(channel, handler); },
} as unknown as Pick<IpcMain, "handle">;
```

The logic to move, all currently inline in `index.ts`:

```ts
const localOpenGenerations = new Map<number, number>();

/** Invalidates any open still in flight for this window, so a superseded one discards its result. */
function nextLocalOpenGeneration(senderId: number): number {
  const generation = (localOpenGenerations.get(senderId) ?? 0) + 1;
  localOpenGenerations.set(senderId, generation);
  return generation;
}

// The renderer names the worktree on every read; only the one this window actually has
// open may be read through, whatever path arrives over IPC.
function requireOpenWorktree(senderId: number, path: string): void {
  if (localViews.get(senderId)?.worktree.path !== path) {
    throw new Error(`${path} is not the open local worktree`);
  }
}
```

and the five local channels that use them: `gander:openLocal`, `gander:refreshLocal`,
`gander:listLocalFiles`, `gander:localFile`, and the local image channel. `openLocal`
is the interesting one — it starts a watcher, then checks whether its generation is
still current and closes the watcher it just made if not.

Conventions: tests use real dependencies rather than mocks, but "real" here means the
real git engine against a real throwaway repository (`main/fixtures.ts`), not a real
`BrowserWindow`. The `ipc` and `sender` seams are the exception the repo already
accepts, as `settings-ipc.test.ts` shows. Comments explain *why*.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full suite | `pnpm test` | all pass |
| New tests only | `pnpm vitest run packages/app/src/main/local-ipc.test.ts` | all pass |
| The app still starts | `bin/dev` then `bin/dev status`, then `bin/dev stop` | app and service both healthy |

## Scope

**In scope**:
- `packages/app/src/main/local-ipc.ts` (create)
- `packages/app/src/main/local-ipc.test.ts` (create)
- `packages/app/src/main/index.ts` (remove the moved handlers, call the new registrar)

**Out of scope** (do not touch):
- `packages/app/src/main/settings-ipc.ts` — already done; it is the template, not the
  target.
- `packages/app/src/main/local-viewer.ts` — the watcher itself is not changing.
- `packages/app/src/main/git.ts` — no engine changes.
- The renderer and `preload/api.ts` — **channel names must not change**. The preload
  calls them by string; renaming one silently breaks the app.
- The repo/connection/settings handlers in `index.ts`. They deserve the same treatment
  but are a separate change; doing everything at once makes the composition-root diff
  impossible to review.

## Git workflow

- Branch: `advisor/002-local-ipc-tests`
- Commit the extraction and the tests separately, so the extraction can be reviewed as
  behaviour-preserving on its own.
- Message style: plain imperative sentence with a body explaining why. See `git log`.
- Do not push or open a PR unless asked.

## Steps

### Step 1: Extract the local-worktree handlers into `local-ipc.ts`

Create `registerLocalIpc` following `registerSettingsIpc`'s shape exactly: take the
`ipc` object as `Pick<IpcMain, "handle">`, and take everything else it needs as
parameters rather than reaching for module state — the git engine, the watcher
factory (`watchLocalView`), and a way to look up a repo's local path.

Move `localViews`, `localWatchers`, `localOpenGenerations`, `closeLocalView`,
`nextLocalOpenGeneration`, and `requireOpenWorktree` into it, keeping their comments.

The `event.sender` dependency is the one thing that cannot be a plain parameter.
Depend only on the narrow surface actually used — an id, an `isDestroyed()`, a
`send()`, and an `once("destroyed")` — and type it as a local interface rather than
Electron's `WebContents`, so a test can supply a plain object.

This step changes no behaviour. Channel names, argument order, thrown error messages,
and return values all stay identical.

**Verify**: `pnpm typecheck` → exit 0, and `pnpm test` → all pass (nothing tests this
yet, so this only proves nothing else broke).

### Step 2: Confirm the app still runs before writing any tests

The extraction touches the composition root, and there is no smoke test to catch a
window that comes up blank (see `plans/README.md`). Check by hand once, now, while
the diff is small.

Run `bin/dev`, open a local repository, expand a directory in Explorer, select a
file, and switch to Current Diff. Then `bin/dev stop`.

**Verify**: the Explorer tree lists files, a selected file shows content, and Current
Diff renders. If `window.gander` is undefined or a local channel throws, the
extraction is wrong — fix it before continuing.

### Step 3: Test the authorization check

Create `local-ipc.test.ts` modelled on `settings-ipc.test.ts` — same handler-collecting
fake for `ipc`, plus a fake sender. Use the real git engine against a real fixture
repository for the worktree, as `git.test.ts` does.

Cover:
- a read channel called with the path this sender has open → succeeds
- the same channel called with a *different* path, including a path that is a real
  worktree of the same repo → throws `is not the open local worktree`
- a read channel called before any `openLocal` → throws rather than reading anything
- each of the four read channels enforces it, driven from a list of channel names so
  adding a fifth without the guard is visible

That last one is the point: the bug this protects against is a new channel that
forgets the check, so assert over the set rather than one channel at a time.

**Verify**: `pnpm vitest run packages/app/src/main/local-ipc.test.ts` → all pass.

### Step 4: Test the supersession rule

Cover, with a watcher factory the test controls so opens can be ordered
deterministically:
- two `openLocal` calls where the first resolves last → the first's watcher is closed,
  the second's is retained, and `localViews` holds the second's view
- a superseded open does not leave a watcher running (assert the factory's watchers
  saw `close()`)
- a sender that reports `isDestroyed()` during an update → the view is closed and
  nothing is sent
- `destroyed` fires → the watcher closes

**Verify**: `pnpm vitest run packages/app/src/main/local-ipc.test.ts` → all pass.

### Step 5: Prove the tests actually catch the bugs

For each of the two guarantees, break it deliberately, confirm a test fails, then
restore. This is the repo's stated rule — a test that does not fail without the fix is
not evidence.

- Delete a `requireOpenWorktree` call from one channel → the step 3 set-driven test
  must fail.
- Invert the generation comparison (`!==` to `===`) → a step 4 test must fail.

**Verify**: each break produces a failing test named in the output; `pnpm test` is
green again after restoring.

## Test plan

All new tests live in `packages/app/src/main/local-ipc.test.ts`, modelled structurally
on `packages/app/src/main/settings-ipc.test.ts` (fixture function returning the fake
ipc, the collected handlers map, and the collaborators) and using
`packages/app/src/main/fixtures.ts` for the real repository, as `git.test.ts` does.

Cases are enumerated in steps 3 and 4. The step 5 breakages are the evidence that they
are worth having.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with `local-ipc.test.ts` passing
- [ ] `grep -c "ipcMain.handle" packages/app/src/main/index.ts` is lower than 28 by
      exactly the number of channels moved
- [ ] `grep -rn "gander:openLocal\|gander:refreshLocal\|gander:listLocalFiles\|gander:localFile" packages/app/src/preload/api.ts`
      still matches the same channel names as before the change
- [ ] Step 2's manual run was done and the app worked
- [ ] `git diff --stat` shows no files changed outside the in-scope list
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report if:

- Any channel name would have to change to make the extraction work. It must not —
  the preload calls them by string and nothing typechecks that relationship.
- The extraction requires importing `electron` into `local-ipc.ts` for anything beyond
  a `type` import. That would make it untestable again, which is the whole point.
- The app fails to start at step 2 and the cause is not obvious within a couple of
  attempts.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Every new local-worktree channel must call `requireOpenWorktree`. The set-driven test
  in step 3 is what makes forgetting visible; keep new channels in that list.
- The repo, connection, and GitHub-token handlers in `index.ts` are still untested and
  still inline. Same treatment, separate change — `chooseLocalRepo`, `removeRepo`
  (which clears `lastReview` when it pointed at the removed repo), `setGithubToken`
  (empty string means "fall back to `gh`"), and `setConnection` (saves only after the
  connection answers) all have real branching.
- A reviewer should check that the extraction is genuinely behaviour-preserving:
  identical channel names, identical thrown messages, identical return values.
- This plan is a prerequisite for the Electron upgrade (003) only in the sense that it
  raises confidence in the IPC layer. It does not replace a smoke test on the packaged
  build, which is still missing (issue #91).
