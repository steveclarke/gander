<p align="center">
  <img src="brand/svg/logo-horizontal-color.svg" width="280" alt="Gander">
</p>

<p align="center">A desktop app for reviewing code diffs, branches, and pull requests.</p>

## Install

Packaged releases are available from [GitHub Releases](https://github.com/steveclarke/gander/releases):

- On Apple silicon macOS, open the versioned `.dmg` and drag Gander to Applications.
- On Linux, download the versioned `.AppImage`, make it executable, and run it.

The macOS Homebrew cask is prepared but its separate personal tap has not been
published yet. Once that manual tap setup is complete, the install command will be:

```
brew install --cask steveclarke/gander/gander
```

Packaged macOS and AppImage builds check GitHub Releases once at launch. An
update downloads in the background, then Gander asks before restarting and
installing it. Choosing **Later** does not install the update when Gander quits.
Use **Gander → Check for Updates…** on macOS or **Help → Check for Updates…** on
Linux to check immediately. Development builds never contact the update feed.

## Getting started

```
bin/setup
bin/dev
```

`bin/setup` installs dependencies, allocates a port, and generates a local
service token. `bin/dev` starts the review service and the app together.
`bin/dev --hosted` starts only the app and uses the hosted connection saved in
this checkout's settings; see `DEVSTACK.md` for the setup and precedence rules.

Reviewing a pull request needs `git` and a GitHub API token. The GitHub CLI is
not a runtime requirement: Gander calls GitHub's REST API directly. Today it
looks for a token in this order:

1. `GANDER_GITHUB_TOKEN`, for development and automation
2. the token entered in Settings → Connection
3. an existing `gh auth login` session, as a convenience fallback

Git operations use the system `git` binary and its configured credential
helper. Until built-in sign-in lands, a token entered in Settings is stored in
Gander's mode-`0600` config file rather than the OS credential store. See
[the GitHub authentication decision](docs/github-authentication.md) for the
planned replacement and current security boundaries.

See `DEVSTACK.md` for the dev stack, and `docs/STATE.md` for where the project
stands.

## Settings

Gander exposes VS Code-style public keys in its Settings JSON view. File-tree
typography is deliberately separate from editor typography:

- `window.zoomLevel` sets the persisted scale for every window. `0` is 100%,
  and fractional values provide finer control than the View menu shortcuts.
- `workbench.tree.fontFamily` and `workbench.tree.fontSize` control file and
  directory labels.
- `workbench.tree.inheritEditorTypography` explicitly switches the tree to
  `editor.fontFamily` and `editor.fontSize` while preserving the independent
  tree values.

The default tree uses the macOS system UI stack at 13px, matching the compact
workbench typography used by VS Code Explorer rather than its code editor.
