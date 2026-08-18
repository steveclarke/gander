---
name: review-with-gander
description: Start a Gander development worktree on its own pull request and exchange review questions through the worktree-local CLI. Use when asked to open the current PR in Gander, dogfood Gander changes, read or address Gander review questions, or verify a worktree's MCP endpoint.
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

## Read review questions

Use the repository and PR resolved above:

```bash
bin/mcp call get_review_questions repo=OWNER/REPO prNumber=NUMBER
```

Run the command after the reviewer says questions are ready, or poll at a
reasonable interval when the reviewer explicitly asks the agent to wait. Do
not register this endpoint globally in Claude or Codex. `bin/mcp` reads this
worktree's endpoint and bearer token from `.env`.

## Address a question

Treat a question as work, not as a checkbox:

1. Inspect the named file, line, and current diff.
2. Make the requested change or explain why it should not change.
3. Run the verification appropriate to the change.
4. Commit and push the result when code changed.
5. Mark the question addressed with a concrete note:

```bash
bin/mcp call mark_question_addressed id=QUESTION_ID commitRef=COMMIT_SHA note="WHAT CHANGED"
```

Only the reviewer resolves a question after re-reviewing the file. The current
MCP contract has no threaded agent reply; the `note` on
`mark_question_addressed` is the temporary response channel.

## Diagnose the bridge

- `bin/mcp check` verifies health, authentication, MCP negotiation, and the two
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
