# Brief: end-to-end test harness

## Mission

Gander is an Electron app for reviewing pull requests. Every layer below the
window is tested against real dependencies — real git repositories, real bare
clones, real service instances, no mocks. The window itself is untested: nothing
drives the real application, clicks anything, or reads what is on screen.

That gap has already cost a bug. A race in `ensureClone` shipped because no test
ever opened a pull request twice; it was found by a person clicking, not by the
suite.

The task is the harness and the first tests through it.

## Scope

Deliver, in order:

1. **A harness that launches the built application and proves it is alive.** One
   test: the window opens and its title is correct. This is the milestone that
   matters — everything after it is comparatively cheap.
2. **The core review loop, end to end.** Register a repository, open a pull
   request, tick a file, restart the application, confirm the tick survived.
3. **The regression the suite missed.** Open a pull request twice in quick
   succession and confirm one clone, no corruption.

Stop after 3. Question capture and MCP can follow later.

## What exists

| Package | Contents |
|---------|----------|
| `@gander/shared` | Domain types and Zod schemas |
| `@gander/service` | Fastify + better-sqlite3 review state and MCP endpoint, bearer auth |
| `@gander/app` | Electron main (git engine, review orchestration) + Vue renderer |

- `pnpm test` runs vitest across all packages. End-to-end tests must not run
  under that command — they are slower and need a build. Give them their own
  script.
- `pnpm --filter @gander/app build` produces the Electron bundle via
  electron-vite.
- `bin/dev` starts the whole stack under process-compose; `DEVSTACK.md` explains
  it. Tests should start what they need themselves rather than depending on a
  stack a person happens to have running.
- `wdio-electron-service` is the proposed driver. Use something else if it turns
  out to be the wrong tool, and say why in the pull request.

## The seams

Two things the application reaches for that a test must control.

**The service.** `GANDER_SERVICE_URL` and `GANDER_TOKEN` override the config
file at connection time, and `GANDER_CONFIG` moves the config file itself. A
test can therefore point the application at its own service on its own port with
its own database. See `resolveServiceConnection` in
`packages/app/src/main/config.ts`.

**GitHub.** This one has no seam yet, and it is the design problem in this task.
`packages/app/src/main/github.ts` calls `api.github.com` directly to list open
pull requests, so an end-to-end test either needs network and credentials — both
unacceptable in a test — or a way to point that call at a local fake serving
fixture JSON. `listOpenPrs` already takes an injectable `fetchImpl`, which is
most of the way there; what is missing is a way to reach that from outside the
process. Adding an environment variable for the API base is the obvious move.
Decide it, implement it, and explain the choice.

Git itself needs no fake. `packages/app/src/main/fixtures.ts` builds real
repositories with real `refs/pull/N/head` refs, which is what the existing git
tests clone from. Reuse it.

## Conventions

- TypeScript strict, ESM only, no `any`.
- Comments explain why, never what. Reserve them for decisions a reader would
  otherwise have to reconstruct.
- Tests assert on behaviour a person would notice, not implementation detail.
- Real dependencies. A mocked git engine or a stubbed service would recreate the
  exact blind spot this task exists to close.

## Guardrails

- Branch from `devstack-bootstrap`, which is where all current work lives.
  `master` is an earlier state and is missing most of the application.
- Commit and push freely on the branch. Open a pull request when the three tests
  above pass.
- Changing application code to make a test pass is sometimes correct — the
  GitHub seam is exactly that — but say so plainly in the pull request rather
  than folding it in quietly.
- Leave `bin/dev`, `outport.yml`, and `process-compose.yml` alone unless the
  harness genuinely requires a change to them.

## Done

Three tests pass from a clean checkout with no network, no GitHub credentials,
and no already-running service, by one documented command. `DEVSTACK.md` names
that command.
