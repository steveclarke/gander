---
name: review-with-gander
description: Start a Gander development worktree on its own pull request and exchange review notes through the worktree-local CLI. Use when asked to open the current PR in Gander, dogfood Gander changes, read or address Gander review notes, or verify a worktree's MCP endpoint.
---

# Review With Gander

Use the Gander instance owned by the current worktree. Its `.env`,
`.gander/config.json`, database, service URL, token, and process-compose socket
belong together. Never borrow a port, token, config, or process from another
worktree.

## Open the current pull request

1. Work from the Gander worktree root.
2. Resolve the current PR with `gh pr view --json number,url,headRefName` and
   resolve the repository ID with `gh repo view --json nameWithOwner`.
3. Start the worktree stack with `bin/dev -D`, unless `bin/dev status` shows it
   already running.
4. Open the PR in that worktree's app:

   ```bash
   bin/gander --repo OWNER/REPO --pr NUMBER
   ```

   The command registers the repository if the app has not seen it, and prints
   what it opened or why it could not. Never edit `.gander/config.json` to steer
   the app.
5. Run `bin/mcp check`. Report any dev-stack or MCP error; do not claim the PR
   is ready merely because an Electron process exists.
6. Tell the reviewer the exact PR and worktree instance that are open.

## Read review notes

Use the repository and PR resolved above:

```bash
bin/mcp call get_review_notes repo=OWNER/REPO prNumber=NUMBER
```

Run the command after the reviewer says notes are ready, or poll at a
reasonable interval when the reviewer explicitly asks the agent to wait. Do
not register this endpoint globally in Claude or Codex. `bin/mcp` reads this
worktree's endpoint and bearer token from `.env`.

Each result has a PR-scoped `number` for discussion and a separate global `id`
for tool calls. Say "Note 4" using `number`; pass its `id` to the mutation tools
below.

## Address a note

Treat a note as work, not as a checkbox:

1. Inspect the named file, line, and current diff.
2. Claim it before starting:

```bash
bin/mcp call mark_note_in_progress id=NOTE_ID
```

3. Make the requested change or explain why it should not change. If work needs a
   reviewer decision, call `mark_note_in_progress` again with
   `note="DECISION NEEDED"`.
4. Run the verification appropriate to the change.
5. Commit and push the result when code changed.
6. Mark the note addressed with a concrete summary. Include `commitRef` only when
   the outcome produced a commit:

```bash
bin/mcp call mark_note_addressed id=NOTE_ID commitRef=COMMIT_SHA summary="WHAT CHANGED"
```

Discuss the note with the reviewer in the active agent session. Only mark it
addressed after the work is complete, and use `summary` for a concise durable
record of what changed. Only the reviewer resolves a note after re-reviewing the
file; the MCP contract has no reply tool.

## Diagnose the bridge

- `bin/mcp check` verifies health, authentication, MCP negotiation, and the three
  required tools.
- `bin/mcp tools` lists the live contract.
- `bin/mcp tui` opens MCP Inspector's terminal UI.
- `bin/mcp inspect` opens its web debugger on ports allocated to this worktree.
- Read `DEVSTACK.md` before changing how the stack or instance discovery works.

`bin/gander` and `bin/mcp` are both worktree-local: each reads this checkout's
endpoint, token, and app socket from `.env`, so a command run here reaches this
worktree's app and service and no other. An installed `gander` CLI will replace
`bin/gander` once the app is packaged, and must keep that scoping with an
explicit override for another instance.
