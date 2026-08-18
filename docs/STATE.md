# Gander — current state

## Where the work is

M1 is merged to `master`.

- Spec: `docs/superpowers/specs/2026-08-15-gander-design.md` (approved, binding)
- Plan: `docs/superpowers/plans/2026-08-15-m1-walking-skeleton.md` (all 11 tasks complete)
- UI design of record: `docs/mockups/mockup-v4.html`

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

## Not in M1

Carried into M2 planning:

- Questions drawer and the MCP endpoint
- The "since my ✓" delta tab
- Local branch/worktree viewer (stateless, no review state)
- Three spec items the M1 plan omitted: the Fetch origin segment, the file-tree
  toggle, and the status bar showing service reachability and last fetch
- Sticky `store.error` — errors currently clear too eagerly
- Progress feedback during a first clone. Its absence caused repeated clicks on
  an unresponsive button, which surfaced the clone race fixed in b575f50.
- End-to-end tests. M1 has no harness driving the real Electron window; every
  layer below it is tested. The clone race was invisible to the whole suite
  because no test ever clicked twice.

## Open decision

Whether M2 opens with the E2E harness (`wdio-electron-service` driving the
packaged app) or with features.
