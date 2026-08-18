# Gander dev stack

Two processes — the review service and the Electron app — supervised by
process-compose, with ports allocated by outport.

## Commands

| Task | Command |
|------|---------|
| First run after a clone | `bin/setup` |
| Start (TUI) | `bin/dev` |
| Start (headless, for agents) | `bin/dev -D` |
| Stop | `bin/dev stop` |
| Status | `bin/dev status` (add `--json` for machine-readable) |
| Logs | `bin/dev logs service` |
| Restart one process | `bin/dev restart service` |
| End-to-end tests | `pnpm test:e2e` |

`pnpm test:e2e` builds the Electron app, starts an isolated service and local
GitHub fake, creates real temporary Git repositories, and runs the three window
tests. It does not use the dev stack, GitHub credentials, or an existing Gander
service. The ordinary `pnpm test` command continues to run only the fast Vitest
suite.

## Processes

| Process | Command | Waits for |
|---------|---------|-----------|
| `service` | `@gander/service` — Fastify + SQLite review state | — |
| `app` | `@gander/app` — electron-vite dev | `service` healthy |
| `urls` | Prints allocated ports, then idles | `service` healthy |

`service` is probed with `curl -sf $GANDER_SERVICE_URL/healthz`. `app` is set to
`restart: "no"` — closing the Electron window is a quit, not a crash.

## Where state lives

| Path | Contents |
|------|----------|
| `.env` | Allocated port, service URL, generated dev token |
| `.pc_env` | The same values plus `PC_SOCKET_PATH`, read by process-compose at startup |
| `.gander/config.json` | Repo-local app config — registered repos |
| `.gander/gander.db` | Review state (checkoffs, snapshots) |

All four are gitignored. `~/.config/gander/config.json` is never read by the dev
stack; the app reads `GANDER_CONFIG` instead.

Bare clones of reviewed repositories are the one shared resource — they live in
Electron's userData directory, so a second checkout reuses the download rather
than fetching it again.

## Worktrees

`outport up` gives each worktree its own port, and `PC_SOCKET_PATH` gives it its
own process-compose control socket, so `bin/dev status` in one checkout never
reaches another's stack. In a new worktree: `bin/setup`, then `bin/dev`.

## Registering the MCP endpoint with an agent

Agents read the reviewer's questions from the same service, at `/mcp`, with the
same bearer token. Port and token are allocated per checkout, so the command is
generated rather than committed — read the live values out of `.env`:

```
source .env
claude mcp add --transport http gander "$GANDER_SERVICE_URL/mcp" \
  --header "Authorization: Bearer $GANDER_TOKEN"
```

Run it in the repository being reviewed, not in this one. Two tools appear:

| Tool | Purpose |
|------|---------|
| `get_review_questions` | Open questions for a repo + branch (or pull request number), with file and line |
| `mark_question_addressed` | Flags one as acted on, with an optional commit ref and note |

Nothing over MCP resolves a question. That stays the reviewer's act, made by
re-reviewing the file in the app.

## Config precedence

`GANDER_SERVICE_URL` and `GANDER_TOKEN` from `.env` override the URL and token in
`.gander/config.json`. The override is applied at connection time, not at load
time, so registering a repo cannot write an allocated port back into the file.
