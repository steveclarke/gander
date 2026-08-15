# Gander — Design Spec

*2026-08-15*

Gander is a cross-platform desktop app for reviewing code in the agentic era. Agents write most of the code; the human's job is review. Gander is that job's dedicated tool: one window over every repo, worktree, and pull request, with a VS Code-quality diff experience, hierarchical checkoff, and a question pipeline that feeds review feedback straight to coding agents over MCP.

"Take a gander."

## Why it exists

The VS Code + GitHub Pull Requests extension workflow works, but drags a full editor along with it: slow startup, one window per worktree, manual hunting for agent-created worktree paths, and no way to capture review questions for an agent that is busy on something else. GitHub's own review UI is heavier than the agentic workflow needs — the agent, not GitHub, is the counterparty for review feedback.

Gander keeps the parts that work (the diff experience, the file-tree checkoff) and replaces the rest:

- One app, all repos — no per-worktree windows or terminals.
- Review state that follows the reviewer across machines.
- File-level questions captured mid-review in seconds, delivered to agents over MCP, with answers flowing back as status.
- A "what changed since I checked this off" delta view, so churned files cost seconds to re-review instead of minutes.

## Core concepts

### Two modes

| Mode | What it is | State |
|---|---|---|
| **PR review** | Full review experience for a GitHub pull request (drafts included): checkoff, snapshots, delta views, questions, MCP | Persisted in the review service, keyed `repo + PR number` |
| **Local viewer** | Live read-only window onto any local checkout or worktree: what is this branch changing right now | None — pure derived data, machine-local by nature |

The split is deliberate. A PR is a published changeset — identical from every machine, so review state about it can be shared. Local working trees differ per machine, so v1 persists no state about them; it only shows them. (A content-anchored model for local review state was designed and shelved for v2 — see Future.)

### Review state is content-based

- A file checkoff stores a **snapshot** of the exact content reviewed (both diff sides, compressed — kilobytes).
- A file stays checked as long as its current content matches the snapshot. Rebases, squashes, and force-pushes that don't change content don't disturb the review.
- When content genuinely changes, the file un-checks and gains a "changed since your review" marker — and the snapshot powers a **delta diff**: reviewed version vs current version, so only the new changes need reading.

### Question lifecycle

| State | Set by | Meaning |
|---|---|---|
| `open` | Reviewer | Captured, visible to agents over MCP |
| `addressed` | Agent via MCP | Work done; optional commit ref + one-line note |
| `resolved` | Reviewer | Delta re-reviewed, file re-checked |

Questions attach to a file, with optional line context stamped automatically when a line/hunk is selected at capture time. A question with no file is a PR-level note. Resolution is always the reviewer's act — no MCP tool can mark anything resolved. Re-checking a file resolves its `addressed` questions; `open` questions survive a re-check and stay visible to agents until addressed or deleted by the reviewer (questions can be deleted at any time from the drawer).

## Architecture

Three pieces:

| Piece | Runs | Owns |
|---|---|---|
| **Desktop app** — Electron + Vue 3 + Monaco | Each machine (macOS, Linux) | Everything derived from repos: clones, diff computation, worktree discovery, file watching, rendering. Read-only cache of review state. |
| **Review service** — TypeScript, Docker, SQLite | One self-hosted host on the user's network | Everything the reviewer authors: checkoffs + snapshot content, questions, statuses, archives. |
| **MCP endpoint** — official TypeScript MCP SDK, streamable HTTP | Part of the service | The agent contract (below). |

Cross-machine review is not a sync feature; it is the topology. The service is the single source of truth for authored state; any machine's app renders the same review, and agents reach the same MCP endpoint whether or not any GUI is running.

- **Auth**: one shared bearer token (service API and MCP alike). LAN/VPN only; never internet-exposed.
- **Service unreachable**: the app shows everything from its local read cache and fails writes loudly. No write queue, no conflict resolution.
- **Version handshake** on connect: a stale service tells the user to update instead of failing strangely.

### Why Electron (not Tauri)

The diff experience is the product's most important feature, and "the VS Code diff" is literally Monaco's diff editor. Electron ships Chromium — Monaco's home engine — on both platforms, making diff fidelity a certainty rather than a probability (Tauri's WebKitGTK on Linux is the risk). It also keeps the entire system in TypeScript. The Vue + Monaco frontend is shell-agnostic; a Tauri port remains a contained experiment if footprint ever matters.

## UI

Validated interactively; the reference mockup is `docs/mockups/mockup-v4.html`.

**Segmented context header** (GitHub Desktop grammar). Navigation costs zero pixels until summoned:

- **Repository ▾** — registered repos; dropdown to switch or add.
- **Reviewing ▾** — current PR (or local branch), with draft/open badge and title; dropdown lists the repo's open PRs and local worktrees/branches. Also opened by ⌘K.
- **Fetch origin** — last-refresh status.
- Right side: file-tree toggle, progress pill (`3/14 reviewed`), questions button with open-count badge.

**Two working panes:**

- **File tree** (collapsible pane): changed files as a real tree — nested directories with chevrons, compact single-child chains, per-file checkboxes, and **tri-state directory checkboxes** (checking a directory checks everything beneath it; partially reviewed directories show a dash). Markers per file: status letter (M/A/D), yellow ● for changed-since-review, 🗨 for attached questions.
- **Diff pane** (the rest of the window): Monaco diff, **unified by default** (side-by-side configurable), word-level highlights, folded unchanged regions. Per-file view tabs:
  - **vs main** — the full change (PR base → head).
  - **since my ✓** — delta against the checkoff snapshot (enabled when one exists).
  - **full file** — the whole current file, read-only: served from the working tree when a local checkout exists, otherwise from the PR head via the app's clone. No editing anywhere in the app.

**Question capture**: `n` (or ＋ Question) drops an input over the diff; type or dictate, Enter, done — attached to the current file, saved to the service, line context stamped silently if a selection exists. Capture must cost under five seconds and no context switch.

**Questions drawer**: right-side overlay listing the PR's questions with state (`open` / `addressed` + commit ref + note), plus **Copy** per question and **Copy all** (markdown) as the manual fallback path to any agent.

**Keyboard**: `j`/`k` walk files, `space` toggles reviewed, `n` captures a question, `⌘K` switches review, `⌘1` toggles the tree pane.

**Status bar**: service connection state, last fetch, key hints.

Aesthetic bar: dark-first, VS Code-adjacent typography (monospace diffs, quiet chrome), release quality even as a personal tool.

## Git and data engine

- **Real git only.** The app shells out to the `git` binary for clones, fetches, diffs, and blob access. No reimplementation; behavior matches `git` by definition.
- **App-managed clones.** Registering a repo (by GitHub URL, or by local folder whose `origin` names the GitHub repo) gives the app its own bare clone for PR diff computation. Review works on machines that have never cloned the project manually.
- **PR data** (list, title, description, draft state, base/head) comes from the GitHub API. Auth reuses the `gh` CLI token when present, with a PAT in settings as fallback. GitHub is the only forge in v1.
- **Refresh** by polling open PRs, plus refresh-on-focus. Head moved → re-fetch, recompute, apply the content-based un-check rules.
- **Local viewer diffs**: one rule — merge-base with the default branch → current working tree, **untracked files included** (as additions, honoring `.gitignore`), so a brand-new uncommitted agent file is visible. Worktrees discovered via `git worktree list`; file and ref watching keeps the view live.

## MCP contract

Deliberately tiny — two tools:

| Tool | Input | Behavior |
|---|---|---|
| `get_review_questions` | repo + branch (or PR number); agents derive repo/branch from their own working directory | Returns open questions: id, file, optional line context, text. The service resolves branch → open PR. |
| `mark_question_addressed` | question id, optional commit ref + one-line note | Flips `open → addressed`; appears beside the question in the app |

No tool reads diffs, lists files, touches checkoffs, or resolves questions. Agents have `git` and `gh` for code; this contract carries only the reviewer's questions. Setup is one MCP entry (service URL + bearer token) added once per agent config; a line in team/agent instructions teaches the pickup habit.

## Packaging and distribution

- **Repo**: public, `steveclarke/gander`. No secrets ever — tokens live in the user's password manager and local config.
- **macOS**: signed + notarized via electron-builder; installed via Homebrew cask (personal tap); auto-update from GitHub Releases.
- **Linux**: AppImage (auto-updating) + `.deb`, on GitHub Releases.
- **Service**: Docker image published to ghcr.io from CI; a compose file in the repo is the deployment story.
- No docs site; the README carries setup.

## Error handling

No silent degradation, anywhere:

- Service down → visible banner; reads from cache; writes fail with a message, never queue silently.
- `git`, `gh`, or GitHub API failures surface the actual error text.
- Rate limiting → shown, with the retry time.
- A review whose PR vanished (force-delete) → flagged, state preserved in the archive.

## Testing

- **Git layer**: fixtures build real throwaway repos (worktrees, rebases, force-pushes); assertions run against real `git`. Never mocked.
- **Service**: end-to-end API tests against real SQLite, including the content-match un-check rules and question lifecycle.
- **App**: Vitest for state logic; one Playwright smoke path through Electron — open PR → check file → capture question → see it in the drawer.
- **CI**: GitHub Actions, macOS and Linux runners.

## Out of scope (v1)

- Editing code, of any kind.
- GitHub review machinery: comments, approvals, CI status, merge button.
- Persisted review state for local (non-PR) changes.
- Forges other than GitHub; Windows; offline writes; docs site.

## Future (designed, shelved)

- **Local review state**: every state item anchors to content (as checkoffs already do), and every surface filters by local relevance — pollution-free state for same-branch working trees on multiple machines, converging automatically once content is pushed and pulled. Ready if usage shows PR-only is not enough.
- Question capture in the local viewer (depends on the above).
- Tauri port experiment if Electron footprint ever matters.
- Additional forges (GitLab).
