# Gander dev stack

Two processes — the review service and the Electron app — supervised by
process-compose, with ports allocated by outport. Hosted mode runs only the app
while preserving the checkout's process and config isolation.

## Commands

| Task | Command |
|------|---------|
| First run after a clone | `bin/setup` |
| Start (TUI) | `bin/dev` |
| Start (headless, for agents) | `bin/dev -D` |
| Start app against hosted service | `bin/dev --hosted` (add `-D` for headless) |
| Stop | `bin/dev stop` |
| Status | `bin/dev status` (add `--json` for machine-readable) |
| Logs | `bin/dev logs service` |
| Restart one process | `bin/dev restart service` |
| Open a review in the running app | `bin/gander --repo owner/name [--pr 42]` |
| Check the live MCP endpoint | `bin/mcp check` |
| Debug the live MCP endpoint | `bin/mcp tui` or `bin/mcp inspect` |
| End-to-end tests (build + run) | `pnpm test:e2e` |
| Re-run end-to-end tests without rebuilding | `pnpm test:e2e:run [file]` |

`pnpm test:e2e` builds the Electron app once, then Playwright runs independent
window scenarios across persistence, content-based review state, notes and MCP,
service failure and compatibility, target isolation, keyboard focus, images,
local changes, the real `bin/gander` command, and clone concurrency. Each spec
starts with a fresh Electron process, config,
user-data directory, real service and SQLite database, local GitHub fake, and real
temporary Git repositories. A spec restarts only its own app when restart is the
behavior under test.

The suite uses one worker and no retries. It does not use the dev stack, GitHub
credentials, an existing Gander service, or another worktree's state. On failure
it keeps a screenshot, Playwright trace, and Electron stdout/stderr under
`packages/app/e2e/test-results/`. The ordinary `pnpm test` command continues to
run only the fast Vitest suite.

The Electron window stays hidden by default, while its renderer continues to
paint for Playwright assertions, screenshots, and traces. To watch one scenario
while debugging, run `GANDER_E2E_HEADFUL=1 pnpm test:e2e:run <file>`.

### When the app cannot start Electron

`electron` downloads its archive in a package lifecycle script. Electron 33's
`extract-zip` step can silently stop after the first archive entry when it runs
under Node 24. `electron/dist` then ends up a few hundred kilobytes rather than
roughly 250 MB while the install script still reports success and exits 0.
`bin/dev` then fails with `Error: Electron uninstall`, or Electron starts and
dies with `DevToolsActivePort file doesn't exist`.

Check for it, from the repository root:

```bash
./packages/app/node_modules/.bin/electron --version
```

A working install prints the version. A truncated one raises
`Electron failed to install correctly`. The root `postinstall` hook runs
`bin/repair-electron` after every `pnpm install`. If the binaries are incomplete,
it keeps pnpm and native module builds on Node 24 but reruns only the official
Electron download script under Node 22 through mise. Run `bin/repair-electron`
to repair an existing checkout.

## Processes

| Process | Command | Waits for |
|---------|---------|-----------|
| `service` | `@gander/service` — Fastify + SQLite review state | — |
| `app` | `@gander/app` — electron-vite dev | `service` healthy |

`service` is probed with `curl -sf $GANDER_SERVICE_URL/healthz`. `app` is set to
`restart: "no"` — closing the Electron window is a quit, not a crash.

## Reviewing against a hosted service

Use the checkout-local service while developing service behavior. When this
checkout is being used to review other work, start only its Electron app:

```bash
bin/dev --hosted
```

On the first hosted run, open **Settings → Connection**, enter the hosted URL
and token, then test and save the connection. Gander stores them in this
worktree's gitignored `.gander/config.json`; saving applies owner-only
permissions. Keep the token out of shell history and committed files. Future
hosted runs reuse the saved connection. `bin/dev --hosted -D` provides the same
mode without the process-compose TUI.

The mode is deliberately config-driven. `bin/dev --hosted` loads `.pc_env` only
for this worktree's process-compose and app sockets, removes
`GANDER_SERVICE_URL` and `GANDER_TOKEN` from the child environment, disables
process-compose's `.env` loading, and starts `app` without its `service`
dependency. The existing connection-time resolver therefore uses
`.gander/config.json`. Caller-exported service values do not override it.

Ordinary `bin/dev` is unchanged: it starts both processes and the generated
values in `.pc_env` override the saved connection at connection time. This
keeps local development, worktrees, and test fixtures isolated. `bin/dev stop`,
`status`, and `bin/gander` continue to use the same per-worktree sockets in
either mode. `bin/mcp` remains a tool for the checkout-local service; register
agents directly against the hosted MCP endpoint as described in
`docs/deploy.md`.

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

## Inspecting the running window

Set `GANDER_DEBUG_PORT` before starting the app and the renderer speaks the Chrome
DevTools Protocol on that port, so a layout or state question can be answered against the
window already on screen instead of a rebuild. It is ignored in a packaged build — the
port has no authentication.

```bash
GANDER_DEBUG_PORT=9229 bin/dev
curl -s localhost:9229/json          # the page's webSocketDebuggerUrl
```

Open `chrome://inspect` in Chrome, or drive the socket from a script: `Runtime.evaluate`
reads live geometry and store state, `Page.captureScreenshot` takes a picture of the
window (pass `fromSurface: false` on macOS, or the call hangs whenever the window is not
frontmost), and `Emulation.setDeviceMetricsOverride` resizes the viewport to reproduce a
size-dependent bug.

Restarting the app to attach the port throws away whatever repository, file, and scroll
position the bug appeared in. When the bug is on screen, attach to a second window or
reproduce it again after the restart.

## Testing and debugging MCP

`bin/mcp` runs the official MCP Inspector against the service for the current
worktree. It reads the endpoint, bearer token, and Inspector ports from the
local `.env`; it does not depend on an MCP server registered in Claude or
Codex.

```bash
bin/mcp check
bin/mcp tools
bin/mcp call get_review_notes repo=steveclarke/gander branch=master
bin/mcp call get_review_notes --json '{"repo":"steveclarke/gander","prNumber":4}'
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

Agents read the reviewer's notes from the same service, at `/mcp`, with the
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
| `get_review_notes` | Notes for a repo + branch (or pull request number), with counts for every state; addressed and resolved notes can be included explicitly |
| `mark_note_addressed` | Flags one as acted on, with an optional commit ref and summary |

Discuss notes in the active agent session. Nothing over MCP replies to or resolves
a note. Resolution stays the reviewer's act, made by re-reviewing the file in the
app.

## Config precedence

For ordinary `bin/dev`, `GANDER_SERVICE_URL` and `GANDER_TOKEN` generated in
`.pc_env` override the URL and token in `.gander/config.json`. The override is
applied at connection time, not at load time, so registering a repo cannot
write an allocated port back into the file. Hosted mode deliberately removes
both variables so the saved connection wins as a complete URL-and-token pair.
