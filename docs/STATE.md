# Gander — current state

## Where the work is

M1 is merged to `master`.

- Spec: kept privately (`~/src/backstage/gander/specs/` on the maintainer's machines), approved and binding
- UI design of record: the v4 mockup, kept privately alongside the spec

## M1 — what exists

A working Electron app that opens a GitHub PR, shows its files as a tree with
hierarchical checkoff, renders a unified Monaco diff, and persists review state
to a local Fastify + SQLite service.

| Package | Contents |
|---|---|
| `@gander/shared` | Domain types and Zod schemas |
| `@gander/service` | Fastify + better-sqlite3 review state, bearer auth |
| `@gander/app` | Electron main (git engine, review orchestration) + Vue renderer |

The unit suite and typecheck are clean across all three packages.

Review state is content-based: files key on sha256 of blob text, so checkoffs
survive rebases and force-pushes. A bare un-check retains the snapshot, which
is the base for the M2 delta view.

An already-open review remains readable from the desktop app's in-memory cache
when the review service is unreachable. Authored-state writes fail visibly and
are never queued; after reconnection the service replaces cached review state.
The app also compares the service API version from `/healthz`: an older service
is blocked with an update instruction, while a newer service remains usable with
a visible warning.

## Running it locally

```
bin/setup
bin/dev
```

See `DEVSTACK.md`. Config and review state are repo-local, under `.gander/`.

## Questions

Reviewing while an agent works elsewhere in the repository is what the app is
for, so questions came in immediately after M1 rather than waiting for a
milestone boundary.

Pressing `n` over a file captures a question against it, stamped with the line
being read. Questions carry three states: `open` when captured, `addressed` when
an agent has acted on one, and `resolved` when the reviewer re-checks the file.
Agents reach them over MCP at `/mcp` on the review service — see `DEVSTACK.md`
for registration.

Questions also carry reply threads. Reviewer and agent replies remain attached
to the question and do not change its lifecycle state; agents add replies with
the dedicated MCP reply tool.

Each opened pull request records its own branch, which is how the service maps an
agent's working branch to a pull request without holding GitHub credentials.

A development checkout can run only its Electron app against the hosted service
with `bin/dev --hosted`; ordinary `bin/dev` keeps its isolated local service for
development.

## Local viewer

Gander's primary entry point is a local checkout selected with the native folder
picker. The target switcher remembers it and discovers its linked worktrees with
`git worktree list`. Repository/worktree selection is stable context above the
workspace; the activity bar switches among Explorer, Current Diff, and Pull Requests
without changing what those modes mean.

A selected worktree has two peer views. Explorer shows the complete filesystem tree,
including ignored files but not Git administrative metadata, and loads each directory only
when it is expanded before reading selected files lazily. Current Diff shows the live change
from the default-branch merge base through the current working tree;
untracked files are included unless ignored by Git.

Local views are read-only and machine-local. They do not expose or persist checkoffs,
snapshots, changed-since state, or questions. One bounded poller follows the selected
worktree's files, index, HEAD, and refs and refreshes both the diff and Explorer
when derived content changes.

## Still open

Packaged macOS and Linux releases are published on GitHub. Packaged builds check
those release manifests for updates and ask before restarting to install. The
repository also generates a checksummed Homebrew cask handoff; publishing and
verifying the separate personal tap remains a manual release task.

Interface work and the agent reply channel are tracked as GitHub issues.

## Testing

`pnpm test` runs the unit suites against real git repositories and real service
instances. `pnpm test:e2e` drives the built Electron window through WebDriverIO —
register a repository, open a pull request, tick a file, restart, and confirm the
tick survived, plus the clone race that reached a person before it reached a test.
