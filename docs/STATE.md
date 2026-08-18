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

66 tests pass; typecheck clean across all three packages.

Review state is content-based: files key on sha256 of blob text, so checkoffs
survive rebases and force-pushes. A bare un-check retains the snapshot, which
is the base for the M2 delta view.

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

## Still open

- Local branch/worktree viewer (stateless, no review state)
- Packaging: signing, notarization, and the Homebrew cask. Gander runs only from
  a development checkout.
- The service still runs as a local development process. The design puts it on
  one host on the network, which is what makes a review readable from any
  machine and reachable by agents with no GUI running.

Interface work and the agent reply channel are tracked as GitHub issues.

## Testing

`pnpm test` runs the unit suites against real git repositories and real service
instances. `pnpm test:e2e` drives the built Electron window through WebDriverIO —
register a repository, open a pull request, tick a file, restart, and confirm the
tick survived, plus the clone race that reached a person before it reached a test.
