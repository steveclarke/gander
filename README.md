# Gander

A desktop app for reviewing code diffs, branches, and pull requests.

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
