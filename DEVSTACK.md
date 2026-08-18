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
| Open a review in the running app | `bin/gander --repo owner/name [--pr 42]` |
| Check the live MCP endpoint | `bin/mcp check` |
| Debug the live MCP endpoint | `bin/mcp tui` or `bin/mcp inspect` |
| End-to-end tests | `pnpm test:e2e` |

`pnpm test:e2e` builds the Electron app, starts an isolated service and local
GitHub fake, creates real temporary Git repositories, and runs the three window
tests. It does not use the dev stack, GitHub credentials, or an existing Gander
service. The ordinary `pnpm test` command continues to run only the fast Vitest
suite.

### When the suite cannot start Electron

`electron` and `electron-chromedriver` download archives in package lifecycle
scripts. Electron 33's `extract-zip` step can silently stop after the first
archive entry when it runs under Node 24. `electron/dist` then ends up a few
hundred kilobytes rather than roughly 250 MB while the install script still
reports success and exits 0. The suite then fails with
`spawn ... chromedriver ENOENT`, or Electron starts and dies with
`DevToolsActivePort file doesn't exist`.

Check for it, from the repository root:

```bash
./packages/app/node_modules/.bin/electron --version
```

A working install prints the version. A truncated one raises
`Electron failed to install correctly`. `bin/setup` checks both Electron and
chromedriver after `pnpm install`. If either is incomplete, it keeps pnpm and
native module builds on Node 24 but reruns only the official Electron download
scripts under Node 22 through mise. Rerun `bin/setup` to repair an existing
checkout.

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
| `.env` | Allocated port, service URL, generated dev token, app socket path |
| `.pc_env` | The same values plus `PC_SOCKET_PATH`, loaded by `bin/dev` before every process-compose command |
| `.gander/config.json` | Repo-local app config — registered repos |
| `.gander/gander.db` | Review state (checkoffs, snapshots) |

All four are gitignored. `~/.config/gander/config.json` is never read by the dev
stack; the app reads `GANDER_CONFIG` instead.

Bare clones of reviewed repositories are the one shared resource — they live in
Electron's userData directory, so a second checkout reuses the download rather
than fetching it again.

## Worktrees

Create isolated working copies with `bin/worktree`. The `add` command runs the
full `bin/setup` bootstrap by default, so the new checkout is ready for
`bin/dev` immediately:

```bash
bin/worktree add settings-ui             # Create a branch and worktree
bin/worktree add --gh 3                   # Name the branch from a GitHub issue
bin/worktree add --pr 12                  # Check out a pull request branch
bin/worktree add review --init=false      # Create only; run bin/setup later
bin/worktree add --gh 3 --tmux            # Create, bootstrap, and open in tmux
```

Worktrees live in `~/src/gander-worktrees/<name>/`. Other commands:

```bash
bin/worktree init [name]                  # Bootstrap an existing worktree
bin/worktree list                         # List worktrees and allocated ports
bin/worktree path [query]                 # Find a worktree path
bin/worktree remove <name>                # Stop services and remove it
bin/worktree remove <name> -d -y          # Also delete its merged branch
```

Interactive selection for `init`, `path`, or `remove` requires `gum`. Named
commands work without it.

`outport up` gives each initialized worktree its own port. `PC_SOCKET_PATH`
gives it its own process-compose control socket, so `bin/dev status` in one
checkout never reaches another stack. `.gander/` keeps the registered repos and
SQLite review state local to that worktree. Outport also allocates the two
ports used by MCP Inspector's web client and MCP Apps sandbox, so interactive
inspectors can run in more than one worktree at once.

## Opening a review from the command line

`bin/gander` hands a review to the app already running for this checkout:

```bash
bin/gander --repo owner/name                          # the repository
bin/gander --repo owner/name --pr 42                  # a pull request in it
bin/gander --pr https://github.com/owner/name/pull/42 # the same, from a URL
```

A repository the app has not seen is registered on the spot. The command prints
what was opened, or the reason it could not be.

Delivery is over a Unix socket at `GANDER_APP_SOCKET`, allocated per checkout by
outport, so a command run in a worktree reaches that worktree's window and no
other. Electron's single-instance lock cannot make that distinction — it keys on
the user data directory, which every checkout shares so they can reuse each
other's clones.

The app has to be running: `bin/dev -D` first, then the command.

## Testing and debugging MCP

`bin/mcp` runs the official MCP Inspector against the service for the current
worktree. It reads the endpoint, bearer token, and Inspector ports from the
local `.env`; it does not depend on an MCP server registered in Claude or
Codex.

```bash
bin/mcp check
bin/mcp tools
bin/mcp call get_review_questions repo=steveclarke/gander branch=master
bin/mcp call get_review_questions --json '{"repo":"steveclarke/gander","prNumber":4}'
bin/mcp tui
bin/mcp inspect
```

`check` is the non-interactive smoke test: it verifies service health, bearer
authentication, MCP negotiation, and the core tool contract. `tools` and
`call` expose Inspector's CLI for manual checks. `tui` opens its terminal UI.
`inspect` opens the web debugger using this worktree's Outport allocations.
The Inspector package is an exact development dependency, while
`GANDER_MCP_INSPECTOR_PACKAGE` can select another package version through
`pnpm dlx` for deliberate compatibility testing.

## Registering the MCP endpoint with an agent (optional)

Agents working inside a Gander development worktree should use `bin/mcp` as
documented above. It discovers this worktree's connection without changing
global agent configuration. Direct MCP registration remains available for an
agent working in another repository that needs to reach this Gander instance.

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
