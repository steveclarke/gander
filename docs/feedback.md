# Feedback from use

Observations from reviewing real pull requests in Gander. Each entry is a
candidate for a milestone; none are commitments yet. Entries marked **Addressed**
name the commit that resolved them.

## Nowhere to put review comments — Addressed

Reviewing a pull request while an agent worked elsewhere in the repository left
comments held in the reviewer's head, along with which file each belonged to.
This was the reason the app was built.

Addressed: `n` captures a question against the file and line being read, a drawer
lists them, and agents collect them over MCP.

## Repository registration

Registering a repository requires pasting its full GitHub URL. A browsable list
of the account's repositories would replace the paste step.

Reference points: GitHub Desktop's clone dialog lists the signed-in account's
repositories; the same data is available from the GitHub API the app already
authenticates against.

## Progress indication is present but not noticeable — Addressed

Selecting a pull request takes several seconds — fetching its refs, diffing, and
loading review state. The top bar does show "Working…" during it, in small faint
text at the opposite end of the bar from the menu that was just clicked, and it
reads as idle.

This is the same gap that produced the clone race fixed in b575f50: with nothing
noticeable on screen, the control invites a second click.

Addressed in 0120cd0: the body area now shows a spinner and "Opening pull
request…" while the first pull request loads.

## Launch does not restore the last review — Addressed

The app opens with no repository and no pull request selected, so every launch
starts with two menu selections. Restoring the last reviewed pull request — or
at minimum the last repository — would remove both.

Addressed in 0120cd0: opening a pull request records it in the config, and the
next launch reopens it.

## Settings surface

Configuration lives in a JSON file (`.gander/config.json`, or
`~/.config/gander/config.json` outside the dev stack) and has no UI. A settings
page reading and writing that file is wanted, starting with two entries:

| Setting | Applies to |
|---------|-----------|
| Font family | Diff pane |
| Font size | Diff pane |

Partly addressed in 0120cd0: Cmd +/- /0 zoom the whole window and the level
persists across restarts, which covers reading at a comfortable size. Control of
the diff font independent of the rest of the interface is still open, as is the
settings page itself.

## No control for fetching origin — Addressed

Refreshing a pull request happened only on a 30-second poll and on window focus,
with no button. Addressed in 0120cd0.

## Text labels on icon-sized controls — Addressed

The Fetch origin button paired a small icon with a text label, which reads as
cramped rather than clear. Toolbar controls should be icon-only with a tooltip,
following VS Code's toolbar grammar.

Addressed by adopting Lucide (`lucide-vue-next`) as the icon set and replacing
the emoji and Unicode glyphs throughout: repository, pull request, add, refresh,
tree chevrons, checkbox marks, and the changed-since banner.

## Stacked pull requests are invisible

A feature split across a stack shows up as unrelated pull requests. Reviewing one
and capturing a question against it gives no indication that a sibling exists, or
which of the two a given file belongs to — the reviewer has to remember which
branch holds what.

GitHub's own list shows position within the stack (`1/2`, `2/2`) beside a stack
icon.

The data costs nothing extra: the `pulls` list response Gander already fetches
carries a `stack` object per pull request.

```json
"stack": { "id": 423381, "number": 1029, "size": 2, "position": 1 }
```

A shared `id` groups the members, and `position`/`size` order them. Worth showing
in the Reviewing dropdown, and worth considering for questions — an agent working
one branch of a stack currently sees nothing captured against its sibling.

## Fixed three-column layout squeezes the diff — partly addressed

With the tree, the diff, and the questions panel side by side, the diff — the pane
the whole product exists to display — gets the least room.

Partly addressed: panels resize by dragging, the questions panel docks either
beside the diff or beneath it, and both choices persist. Docking questions to the
bottom gives the diff the full window width.

Still open: arbitrary rearrangement. Panels cannot be dragged into new positions,
torn out, or stacked as tabs the way an editor's panels can. That needs a real
layout engine rather than fixed slots — `dockview` and `golden-layout` are the
established options, and either is a substantial piece of work rather than an
adjustment to what exists.
