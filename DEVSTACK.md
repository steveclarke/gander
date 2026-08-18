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

## Config precedence

`GANDER_SERVICE_URL` and `GANDER_TOKEN` from `.env` override the URL and token in
`.gander/config.json`. The override is applied at connection time, not at load
time, so registering a repo cannot write an allocated port back into the file.
