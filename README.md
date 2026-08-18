<p align="center">
  <img src="brand/svg/logo-horizontal-color.svg" width="280" alt="Gander">
</p>

<p align="center">A desktop app for reviewing code diffs, branches, and pull requests.</p>

## Getting started

```
bin/setup
bin/dev
```

`bin/setup` installs dependencies, allocates a port, and generates a local
service token. `bin/dev` starts the review service and the app together.

Reviewing a pull request needs a GitHub token — `gh auth login` is enough.

See `DEVSTACK.md` for the dev stack, and `docs/STATE.md` for where the project
stands.

## Settings

Gander exposes VS Code-style public keys in its Settings JSON view. File-tree
typography is deliberately separate from editor typography:

- `workbench.tree.fontFamily` and `workbench.tree.fontSize` control file and
  directory labels.
- `workbench.tree.inheritEditorTypography` explicitly switches the tree to
  `editor.fontFamily` and `editor.fontSize` while preserving the independent
  tree values.

The default tree uses the macOS system UI stack at 13px, matching the compact
workbench typography used by VS Code Explorer rather than its code editor.
