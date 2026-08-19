# Plan 001: Read a revision's blobs in one `git cat-file --batch` instead of one process per file

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat b8be583..HEAD -- packages/app/src/main/git.ts packages/app/src/main/review.ts packages/app/src/main/local-viewer.ts`
> If any of those changed, compare the "Current state" excerpts below against the
> live code before proceeding. On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `b8be583`, 2026-08-19

## Why this matters

Three separate paths read blob content one `git show` subprocess at a time, in
series. Measured on this repository, 125 files cost ~0.98s that way and 0.038s
through a single `git cat-file --batch` — a 26x difference that is process spawn
overhead, not git's actual work.

The worst of the three is the local viewer, because it runs on a 500ms timer. A
tick that takes longer than the interval does not overlap (there is a `computing`
guard) — it simply runs back-to-back forever, so a branch with a few hundred
changed files pegs a core for as long as the window is open.

## Current state

Three call sites, all reading blobs per file:

- `packages/app/src/main/git.ts` — `localView`, roughly lines 395-430. After six
  fixed git commands it loops over every changed path and awaits
  `this.showFile(worktreeDir, mergeBaseSha, entry.basePath)` for the base side, plus
  a `workingFile` read (full `readFileSync` + sha256) for the head side.
- `packages/app/src/main/review.ts` — `computeFiles`, the loop that begins
  `for (const { path, status, basePath } of changed)`. Two awaited `showFile` calls
  per file, one at the merge base and one at head, nothing concurrent.
- `packages/app/src/main/review.ts` — `listPrsWithProgress` calls `computeFiles` for
  every pull request that has any stored file state, then uses the result only as
  `files.filter((file) => file.checked).length` and `files.length`. Eight in-flight
  reviews of 60 files each is ~960 subprocess spawns and full text decoding of every
  blob, to draw eight progress counters on the first screen.

The contract any replacement must reproduce exactly is `showFile`, in `git.ts`:

```ts
async showFile(cloneDir, rev, path) {
  let buf: Buffer;
  try {
    buf = await gitBuffer(cloneDir, ["show", `${rev}:${path}`]);
  } catch (err) {
    const msg = (err as Error).message;
    if (PATH_ABSENT_AT_REVISION.test(msg)) return { content: null, hash: null, binary: false };
    throw err;
  }
  return fileResult(buf);
}
```

and `fileResult`:

```ts
function fileResult(buf: Buffer): ShowFileResult {
  const hash = createHash("sha256").update(buf).digest("hex");
  const binary = buf.includes(0) || imageMediaType(buf) !== null;
  return binary ? { content: null, hash, binary: true } : { content: buf.toString("utf8"), hash, binary: false };
}
```

Three properties of that contract are load-bearing and easy to break:

1. **The hash is sha256 over the raw bytes**, not git's object id. Review state is
   content-addressed on this hash (`review.ts`'s `applyServiceState` compares
   `baseHash`/`headHash` against what the service stored). Changing the hash scheme
   would silently un-check every file in every existing review. Do not switch to git
   oids.
2. **A binary blob still gets a real hash** while its content is withheld. That is
   what makes `content === null` readable: `hash === null` means "absent at this
   revision", a real hash means "binary here". `git.ts` documents this on
   `ShowFileResult`.
3. **An absent path returns nulls rather than raising**, but only for the "path is
   absent" case. A bad revision must still throw. `PATH_ABSENT_AT_REVISION` is the
   regex that separates them.

Repo conventions that apply: the git layer shells out to the real `git` binary and
is never mocked — tests build real throwaway repositories via
`packages/app/src/main/fixtures.ts`. Comments explain *why*, not what. See
`git.ts`'s comment on `GIT_ENV` for the density expected.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full suite | `pnpm test` | all pass |
| Git tests only | `pnpm vitest run packages/app/src/main/git.test.ts` | all pass |
| Review tests only | `pnpm vitest run packages/app/src/main/review.test.ts` | all pass |
| One test by name | `pnpm vitest run -t "<name>"` | that test passes |

## Scope

**In scope**:
- `packages/app/src/main/git.ts`
- `packages/app/src/main/git.test.ts`
- `packages/app/src/main/review.ts`
- `packages/app/src/main/review.test.ts`

**Out of scope** (do not touch):
- `packages/service/**` — the service stores hashes; nothing about its schema changes.
- `packages/shared/src/index.ts` — `ChangedFile`/`PrFile` shapes stay as they are.
- `packages/app/src/main/local-viewer.ts` — the 500ms interval and the `computing`
  guard stay. This plan makes each tick cheaper; it does not change the polling model.
- The renderer. No IPC payload shape changes here.

## Git workflow

- Branch: `advisor/001-batch-blob-reads`
- Commit per step. Message style is a plain imperative sentence with a body
  explaining why, no prefixes — see `git log` (e.g. "Diff a renamed file against the
  path its base revision holds").
- Do not push or open a PR unless asked.

## Steps

### Step 1: Add a batched read to `git.ts`, alongside `showFile` rather than replacing it

Add one function that takes many `(rev, path)` pairs and returns a
`ShowFileResult` for each, feeding all specs to a single `git cat-file --batch`
process and parsing its framed output.

`git cat-file --batch` reads one spec per line on stdin and answers with a header
line `<oid> <type> <size>\n`, then exactly `size` raw bytes, then `\n`. A spec it
cannot resolve answers `<spec> missing\n` with no body. Parse by byte count from
the header — never by scanning for newlines, because blob content contains them.

Map each result through the **existing** `fileResult` so hashing and the binary
heuristic stay in one place. Map `missing` to `{ content: null, hash: null, binary: false }`,
matching `showFile`'s absent-path branch.

Keep `showFile` exported and working; other callers still use it.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Cover the batched reader directly, including the cases that break naive parsers

Add tests to `packages/app/src/main/git.test.ts` using `makeFixtureRepo`. It takes
`(featureFiles, baseFiles)` as `Record<string, string | Uint8Array>`, so binary and
awkward paths are easy to seed. Cover:

- several text blobs in one call, each with the same content and hash `showFile`
  returns for the same `(rev, path)` — assert equality against `showFile` directly,
  so the two can never diverge
- a binary blob (a PNG from `packages/app/resources/icon.png`, as
  `review.test.ts` already does): `content === null`, `binary === true`, and a real
  non-null hash
- a blob whose content contains a NUL byte and a blob containing newlines, proving
  the parser frames by size rather than by line
- a path absent at the requested revision: all nulls, no throw
- an empty input list: returns empty, spawns nothing
- a genuinely bad revision: still throws

**Verify**: `pnpm vitest run packages/app/src/main/git.test.ts` → all pass,
including the new tests.

### Step 3: Use it in `computeFiles`

In `review.ts`, replace the per-file loop's two `showFile` awaits with one batched
call collecting every `(mergeBase, basePath)` and `(head, path)` spec first, then
assembling the `PrFile[]`.

Keep the rename behaviour exactly as it is: the base side reads `basePath`, the head
side reads `path`, and `basePath` is set on the file only when it differs from
`path`. There is a test named "diffs a renamed file against its merge-base path
instead of reading it as wholly added" that will catch a regression here.

While in this function, fix the O(n²) lookup below the loop: `state.files.find(...)`
re-scans the checkoff array per file, and `applyServiceState` immediately above
already builds exactly the `Map` that lookup wants. Hoist the map and share it.

**Verify**: `pnpm vitest run packages/app/src/main/review.test.ts` → all pass.

### Step 4: Stop `listPrsWithProgress` reading content it never uses

It needs two integers per pull request: how many changed files there are, and how
many still match their stored hashes. It does not need any file's text.

Split a hash-only path out of `computeFiles` — same `diffFiles` call, same
merge-base logic, same server-side un-check side effect, but resolving only hashes.
`git cat-file --batch-check` returns `<oid> <type> <size>` per spec without bodies
and is the cheap way to ask "does this path exist here", though the sha256 content
hash still requires the bytes; if you cannot avoid reading bytes, batching them
(step 1) is still the win, so do that rather than inventing a second hash scheme.

**Do not drop the side effect.** `computeFiles` writes `putFileState({checked:false})`
for any file that was checked but has drifted, and that runs on this path too. There
is a test named "derives menu progress from current file content with one batched
fetch" that asserts on fetch counts — read it before changing this function.

**Verify**: `pnpm vitest run packages/app/src/main/review.test.ts` → all pass.

### Step 5: Use it in `localView`

Replace the per-path `showFile` call for the base side with one batched call for all
base specs at `mergeBaseSha`. Leave the head side alone: it reads the working tree
through `workingFile`, not git, and that has its own symlink/directory/`O_NOFOLLOW`
handling which must not change.

**Verify**: `pnpm test` → all pass.

## Test plan

New tests in `packages/app/src/main/git.test.ts` as listed in step 2, modelled on
the existing `showFile` tests in that file (same `beforeEach` fixture, same
`engine.ensureClone` / `engine.fetchPr` setup).

The strongest assertion available is equivalence: for the same `(rev, path)`, the
batched reader and `showFile` must return deeply equal results. Write that as an
explicit test over a mixed set — text, binary, absent, NUL-containing — because it
is the property everything else depends on.

No new tests are needed for steps 3-5; the existing `review.test.ts` suite already
covers the content-hash invariant, the rename case, the offline behaviour, and the
progress counts. If those pass unchanged, the refactor preserved behaviour. That is
the point of doing this after them rather than before.

**Verify**: `pnpm test` → all pass, with the new git tests included.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with new batched-read tests passing
- [ ] `grep -n "showFile" packages/app/src/main/review.ts` returns no per-file loop
      in `computeFiles`
- [ ] `git diff --stat` shows no files changed outside the in-scope list
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report if:

- Any existing test in `review.test.ts` fails and the fix is not obvious. That suite
  encodes the content-addressed review invariant; a failure there means behaviour
  changed, not that the test is stale.
- You find yourself wanting to change what `baseHash`/`headHash` contain. The stored
  hashes in the service were written by the current scheme; changing it invalidates
  every existing checkoff.
- `git cat-file --batch` output parsing needs the `--batch-all-objects` or
  `-z`-style flags of a git newer than what CI uses, or behaves differently across
  the git versions you can test.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The batched reader becomes the single place blob reads are framed. Anything added
  later that needs many blobs should use it rather than looping `showFile`.
- A reviewer should scrutinise the parser's byte framing (blob content contains
  newlines, so line-based parsing is the bug to look for) and confirm `fileResult`
  is still the only place hashing and the binary check happen.
- Deliberately deferred: the 500ms poll interval itself, and shipping full file
  content over IPC on every local tick even when the renderer is displaying one file.
  Both are real, both are separate from this change.
