# Product

<!-- impeccable:product-schema 1 -->

## Platform

Electron desktop application

## Users

Gander is for a developer who reviews agent-produced work across several repositories and worktrees at the same time. They need to move quickly among active contexts without managing one editor window per checkout or remembering where agents created worktrees.

## Product Purpose

Gander is one persistent, read-only review workspace over every repository, worktree, and pull request the reviewer cares about. Success means the reviewer can open a repository from disk once, discover all of its worktrees and pull requests, browse any worktree's files and current changes, and keep several reviews in flight without leaving the window or losing their place.

## Positioning

Gander starts from a local Git repository and turns it into a review hub: Git supplies every linked worktree, GitHub supplies its pull requests, and Gander keeps the reviewer oriented across all of them. Unlike an editor, it is optimized for concurrent review rather than code authoring.

## Operating Context

- The reviewer commonly has several repositories and several agent-created worktrees active at once.
- Worktrees may live in temporary or unexpected locations; the reviewer should never need to locate each one manually.
- The reviewer moves among full-file browsing, the current worktree diff, and published pull-request review.
- A single application window replaces multiple project-specific editor windows.
- Repositories opened from disk are remembered locally and remain easy to revisit.

## Capabilities and Constraints

- Opening any checkout introduces its Git repository; URL entry is not the primary workflow.
- A known repository exposes its full file tree, all linked worktrees, and its open pull requests.
- The file explorer shows the selected worktree's complete read-only filesystem tree, including ignored files but excluding Git administrative metadata.
- The current-diff view shows the selected worktree's live change from the default-branch merge base through its working directory, including non-ignored untracked files.
- Pull-request review retains checkoffs, snapshots, changed-since state, notes, and agent replies.
- Local files and current diffs have no persisted review state, notes, or editing.
- Repository and worktree selection is persistent context above the workspace views; Explorer, Current Diff, and Pull Requests are peer lenses over that target.
- GitHub is the only forge in v1. Git and filesystem failures remain visible.

## Product Principles

- Local repository first: the path on disk is the natural front door.
- One window, many contexts: switching replaces window management.
- Git knows the worktrees: never make the reviewer hunt for their paths.
- Files, current changes, and pull requests are peer views of the same repository.
- Repository/worktree selection determines what the reviewer is looking at; the activity bar determines how they are looking at it.
- Preserve context: switching away and back should restore the reviewer's place.
- Review without editing: Gander stays purpose-built for inspection and feedback.

## Accessibility & Inclusion

The complete workflow must be keyboard-operable, expose clear selected and expanded states, preserve visible focus, and avoid relying on color alone for repository, worktree, file, or review status.
