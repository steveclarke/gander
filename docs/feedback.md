# Feedback from use

Observations from reviewing real pull requests in Gander. Each entry is a
candidate for a milestone; none are commitments yet.

## Repository registration

Registering a repository requires pasting its full GitHub URL. A browsable list
of the account's repositories would replace the paste step.

Reference points: GitHub Desktop's clone dialog lists the signed-in account's
repositories; the same data is available from the GitHub API the app already
authenticates against.

## Progress indication is present but not noticeable

Selecting a pull request takes several seconds — fetching its refs, diffing, and
loading review state. The top bar does show "Working…" during it, in small faint
text at the opposite end of the bar from the menu that was just clicked, and it
reads as idle.

This is the same gap that produced the clone race fixed in b575f50: with nothing
noticeable on screen, the control invites a second click.

## Launch does not restore the last review

The app opens with no repository and no pull request selected, so every launch
starts with two menu selections. Restoring the last reviewed pull request — or
at minimum the last repository — would remove both.

## Settings surface

Configuration lives in a JSON file (`.gander/config.json`, or
`~/.config/gander/config.json` outside the dev stack) and has no UI. A settings
page reading and writing that file is wanted, starting with two entries:

| Setting | Applies to |
|---------|-----------|
| Font family | Diff pane |
| Font size | Diff pane |
