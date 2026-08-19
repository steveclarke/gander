# Plan 003: Upgrade Electron 33 → 43 and delete the install-repair workaround

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. This plan has more manual
> verification than most, because the failures it risks are packaging failures that no
> automated check in this repository can see. When done, update this plan's status row
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat b8be583..HEAD -- packages/app/package.json bin/repair-electron package.json AGENTS.md DEVSTACK.md`
> If any changed, re-read them before proceeding. On a mismatch with the excerpts
> below, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L (multi-day; most of it is verification, not code)
- **Risk**: MED-HIGH
- **Depends on**: `plans/002-test-main-ipc-handlers.md` (raises confidence in the IPC
  layer before the runtime moves underneath it). A smoke test on the packaged build
  (issue #91) is not a hard dependency but would materially reduce this plan's risk —
  read "STOP conditions" before deciding to proceed without one.
- **Category**: migration
- **Planned at**: commit `b8be583`, 2026-08-19

## Why this matters

`packages/app/package.json` pins `"electron": "^33.0.0"`, resolving 33.4.11 against a
current 43.x. Electron supports the latest three stable majors, so 33 is well outside
the window and receives no Chromium security backports. This application renders
arbitrary repository content — diffs, file contents, filenames — in that engine.

The upgrade is unusually attractive because it *removes* code rather than adding a
compatibility layer. Electron 33's `extract-zip` truncating under Node 24 is the sole
reason `bin/repair-electron` and the root `postinstall` hook exist. Both come out,
along with their AGENTS.md paragraph and DEVSTACK.md section. Issue #81 tracks this.

## Current state

The pin and its companions, in `packages/app/package.json`:

```json
"electron": "^33.0.0",
"electron-vite": "^3.0.0",
"vite": "^6.4.3",
```

`electron-vite` is at 3 against a current 5, and `vite` at 6 against a current 8. They
move together with Electron; treat them as one upgrade, not three.

The workaround being deleted, `bin/repair-electron`, is wired in at the workspace root:

```json
"postinstall": "bin/repair-electron"
```

Its own header comment states the exit criterion:

> Delete this script, the postinstall hook, and the AGENTS.md note when Electron
> is upgraded past the broken extract-zip. See issue #81.

`AGENTS.md` documents the trap under "**Electron install trap:**" and ends with "Both
the script and the hook come out when Electron is upgraded past the broken
extract-zip." `DEVSTACK.md` has a "### When the app cannot start Electron" section
covering the same ground. Both are part of this change.

Packaging surfaces that must be re-proven, from `packages/app/package.json`:

```json
"dist:mac": "electron-vite build && electron-builder --mac --publish never",
"dist:linux": "electron-vite build && electron-builder --linux",
"dist:unsigned": "electron-vite build && electron-builder --mac --dir -c.mac.identity=null -c.mac.notarize=false"
```

plus `.github/workflows/release-linux.yml`, which builds the AppImage on a runner
pinned to Node 22 *specifically because of the Electron 33 bug* — its comment says so.
That pin should be revisited as part of this change.

Note `packaging/homebrew` and the macOS signing/notarization path exist but are driven
from the maintainer's machine; this plan does not attempt to reproduce a signed build.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full suite | `pnpm test` | all pass |
| Electron binary is real | `./packages/app/node_modules/.bin/electron --version` | prints the new version |
| Renderer + main build | `pnpm --filter @gander/app run build` | exit 0, assets written |
| Unsigned macOS app | `pnpm --filter @gander/app run dist:unsigned` | exit 0, `.app` produced |
| Dev stack | `bin/dev`, `bin/dev status`, `bin/dev stop` | app and service healthy |

## Scope

**In scope**:
- `packages/app/package.json` (electron, electron-vite, vite)
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `bin/repair-electron` (delete)
- `package.json` at the root (remove the `postinstall` hook)
- `AGENTS.md` (remove the install-trap paragraph)
- `DEVSTACK.md` (remove the "When the app cannot start Electron" section)
- `.github/workflows/release-linux.yml` (the Node 22 pin and its comment)
- `packages/app/src/main/**` only if an Electron API actually changed

**Out of scope**:
- The renderer's Vue/Monaco code. If a Vite major forces changes there, that is a
  signal to stop and split the work, not to press on.
- `packages/service/**` and `packages/shared/**` — they do not depend on Electron.
- macOS signing and notarization configuration. Do not touch identities, profiles, or
  the Homebrew cask.
- `@types/node` alignment. Related, tempting, and a separate change (see
  `plans/README.md`).

## Git workflow

- Branch: `advisor/003-electron-43`
- Commit the dependency bump, the workaround deletion, and the doc/CI updates
  separately. If the upgrade has to be reverted, the workaround deletion must revert
  with it.
- Message style: plain imperative sentence with a body explaining why. See `git log`.
- Do not push or open a PR unless asked.

## Steps

### Step 1: Read the breaking changes before touching anything

Electron publishes a "Breaking Changes" document per major. Read the entries for 34
through 43 and write down every one that touches an API this app actually uses. The
relevant surface is small and worth enumerating first: `BrowserWindow` and
`webPreferences`, `ipcMain.handle`, `contextBridge`, `shell.openExternal`,
`setWindowOpenHandler`, `will-navigate`, `app.dock`, `nativeImage`, `Menu`,
`webContents.setZoomLevel`, `safeStorage` (not yet used, but planned), and
`app.getPath("userData")`.

Also check `electron-updater` (`^6.8.9`) for its supported Electron range, since the
packaged app checks GitHub Releases at launch.

Produce a short written list of expected changes before editing. If that list is
empty, you have not read carefully enough — ten majors always change something.

**Verify**: the list exists and names specific APIs, not general areas.

### Step 2: Bump the three dependencies together

Move `electron` to `^43`, `electron-vite` to `^5`, and `vite` to `^8`, then
`pnpm install`.

`pnpm-workspace.yaml` has an `allowBuilds` entry for `electron` and a
`publicHoistPattern` for it; both should still be correct, but confirm rather than
assume.

**Verify**: `pnpm install` exits 0, and
`./packages/app/node_modules/.bin/electron --version` prints a 43.x version. That
second check is the whole reason the workaround existed — a truncated install exits 0
too.

### Step 3: Delete the workaround

Remove `bin/repair-electron`, the root `postinstall` hook, the AGENTS.md install-trap
paragraph, and the DEVSTACK.md section.

Do this only after step 2's version check passed on a clean install. Prove it on a
genuinely clean tree, not an incrementally-updated one:

```
rm -rf node_modules packages/*/node_modules && pnpm install
```

then check the Electron version again.

**Verify**: clean install exits 0 with no `postinstall` hook present, and Electron
still reports 43.x. `grep -rn "repair-electron" . --exclude-dir=node_modules
--exclude-dir=.git` returns nothing.

### Step 4: Build and typecheck

**Verify**: `pnpm typecheck` exits 0, `pnpm test` passes, and
`pnpm --filter @gander/app run build` exits 0. A Vite major is the most likely source
of build-config breakage; `packages/app/electron.vite.config.ts` is a five-line default
config, which is the best case.

### Step 5: Run the app and exercise the paths no test covers

There is no smoke test on the packaged build, so this is the only check that the
window comes up at all. Run `bin/dev` and confirm, by hand:

- the window opens and paints (a blank window means the preload failed — check
  `window.gander` in devtools)
- a local repository opens; Explorer lists files; expanding a directory works
- Current Diff renders a change
- a pull request opens, a file ticks, and the tick survives a restart
- capturing a note with `n` works, and the notes drawer lists it
- zoom shortcuts work, and the level survives a restart
- clicking an external link in a diff opens the system browser and does **not**
  navigate the window

That last one is a security guarantee (`main/index.ts`'s `setWindowOpenHandler` and
`will-navigate`), and Electron majors have changed window-open behaviour before.

**Verify**: every item above behaves as described. `bin/dev stop` afterwards.

### Step 6: Prove the packaged build

**Verify**: `pnpm --filter @gander/app run dist:unsigned` exits 0 and produces a
`.app`. Launch it directly — not through `bin/dev` — and confirm the window opens and
one review loads. A dev-mode run does not prove the packaged one; the preload path,
`app.getPath("userData")`, and the update feed all differ.

### Step 7: Revisit the CI Node pin

`.github/workflows/release-linux.yml` pins Node 22 with a comment naming the Electron
33 extraction bug, and installs with `--ignore-scripts` for a related reason. With the
bug gone, re-evaluate both and update the comments to say whatever is true afterwards.

Do not change the pin blindly — if the AppImage build depends on Node 22 for some
other reason, leave it and correct the comment instead.

**Verify**: the workflow file's comments describe the current reason for each choice,
and a release build succeeds. If a release build cannot be run here, say so in the
handoff rather than assuming.

## Test plan

There are no new unit tests to write — nothing in `pnpm test` exercises Electron
itself, which is precisely the gap that makes this plan risky.

The verification is steps 5 and 6, done by hand, and they are not optional. Record what
was checked and on which platform in the commit body, so the next person knows what
was actually proven and what was not (for example: verified on macOS, Linux AppImage
unverified).

If issue #91's smoke test lands before this plan runs, add it to the gate and say so
here.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] `./packages/app/node_modules/.bin/electron --version` prints 43.x after a clean
      `rm -rf node_modules && pnpm install`
- [ ] `grep -rn "repair-electron" . --exclude-dir=node_modules --exclude-dir=.git`
      returns nothing
- [ ] `grep -n "postinstall" package.json` returns nothing
- [ ] `pnpm --filter @gander/app run dist:unsigned` exits 0 and the packaged app opens
      a review
- [ ] Step 5's manual checklist completed, including the external-link check
- [ ] `plans/README.md` status row for 003 updated, naming what was verified manually

## STOP conditions

Stop and report if:

- Step 1's breaking-changes reading turns up a change to `contextBridge`, preload
  loading, or `webPreferences` semantics that would alter how `window.gander` is
  exposed. That interacts with the separate `sandbox: false` question recorded in
  `plans/README.md`, and the two should be decided together rather than one being
  changed underneath the other.
- The Vite major requires changes to renderer source (Vue components, Monaco setup)
  rather than to config. Split the Vite upgrade into its own change.
- The packaged build fails and the cause is in signing, notarization, or the Homebrew
  cask. Those are out of scope and driven from the maintainer's machine.
- Any item in step 5's checklist fails and is not clearly fixed by an API change you
  identified in step 1.
- You cannot run step 6 at all on this machine. Report that rather than marking the
  plan done — an Electron upgrade verified only by unit tests is not verified.

## Maintenance notes

- After this lands, Electron majors should be taken more often and in smaller hops.
  Ten at once is expensive precisely because it was left this long.
- A reviewer should confirm the workaround deletion is complete — script, hook,
  AGENTS.md paragraph, DEVSTACK.md section, and any lingering mention — and that the
  commit body records which manual checks were actually performed.
- Deliberately deferred: `@types/node` alignment (app is `^22`, service `^26`, runtime
  Node 24), and the TypeScript major split between the root and `packages/app`. Both
  are recorded in `plans/README.md`.
- The `sandbox: false` decision in `main/index.ts` is untouched here but sits in the
  same file and the same subject area. If it is revisited, do it as its own change with
  its own verification that `window.gander` is still defined in a packaged build.
