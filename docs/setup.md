# Setting up Gander

This guide takes a developer from nothing to a first reviewed pull request, with
an agent reading the review notes. It covers the packaged app. Working on Gander
itself starts from `bin/setup` instead (see the README and `DEVSTACK.md`).

Gander has two halves:

- **The app** runs on the reviewer's machine. It clones repositories, reads pull
  requests from GitHub and shows the diffs.
- **A review server** keeps what the reviewer writes: which files are checked
  off, the content they were checked against, and notes. Agents read notes from
  the same server over MCP. The server is either a team server, such as
  Outport's at `https://outport.app/gander`, or one the reviewer runs
  (`docs/deploy.md`).

## What is needed

- macOS on Apple silicon, or Linux on x86-64
- `git`, with credentials that can clone the repositories being reviewed
- a GitHub account with access to those repositories
- for a team server: an account on it and a personal token
- for an agent: Claude Code, or another MCP client

## 1. Install the app

1. Open the latest release at
   <https://github.com/steveclarke/gander/releases/latest>.
2. On macOS, download `Gander-<version>-arm64.dmg`, open it and drag Gander to
   Applications. The app is signed and notarized, so it opens without a warning.
3. On Linux, download `Gander-<version>.AppImage`, then make it executable and
   run it:

   ```bash
   chmod +x Gander-*.AppImage
   ./Gander-*.AppImage
   ```

The app checks for updates once at launch, downloads them in the background and
asks before restarting. **Check for Updates…** is in the Gander menu on macOS
and the Help menu on Linux.

## 2. Give Gander a GitHub token

Gander reads pull requests through GitHub's API and mirrors each checkoff to
GitHub's own "Viewed" tick.

1. Create a token at <https://github.com/settings/tokens>. A classic token needs
   the `repo` scope for private repositories (`public_repo` is enough for public
   ones). A fine-grained token needs **Metadata: read** and **Pull requests:
   read and write** on the repositories to review.
2. Open Settings: **Gander → Settings…** (⌘,) on macOS, **File → Preferences →
   Settings** (Ctrl+,) on Linux.
3. Choose **Connection**. Under **GitHub**, paste the token into **Token** and
   choose **Save**.
4. Gander answers **GitHub accepted it: \<your login\>**.

Leaving the field empty makes Gander use the `gh` command's login, when `gh` is
installed and signed in. A saved token always works; it is stored in Gander's
config file, readable only by the owner.

## 3. Add a review server

Each server is added once. Each repository then remembers which server it saves
to.

### Outport (team server)

1. Sign in to Outport and open <https://outport.app/settings/api-tokens>.
2. Choose **New token**. Describe it as "Gander", set **Permission** to
   **Write**, and choose **Create token**. Copy the token: Outport shows it once.
3. In Gander's **Settings → Connection**, under **Review servers**, choose **Add
   server** and fill in:

   | Field | Value |
   |---|---|
   | Name | `Outport` |
   | Service URL | `https://outport.app/gander` |
   | Token | the token from step 2 |

4. Choose **Test**. Gander answers **Connected · \<version\>**.
5. Choose **Save server**.

A Read token can connect but cannot save checkoffs or notes, so the token must be
Write. Reviews on Outport are private: other people on the team do not see them.

### A self-hosted server

1. Run the service with `docs/deploy.md`, which ends with a URL and a token.
2. Add it the same way, with that URL and token, and a name such as `Personal`.

## 4. Open a repository

1. Clone the repository with `git`, if it is not on this machine already.
2. In the bar at the top of the window, open the repository menu and choose
   **Open repository folder…**, then pick the clone.
3. Gander asks every server whether it covers the repository:
   - exactly one says yes: Gander uses it without asking;
   - none or several say yes, or a server cannot be reached: Gander asks once,
     in the window, and remembers the answer.
4. The status bar shows **Notes save to \<server\>**. **Change** there, or the
   **Repositories** list in **Settings → Connection**, moves the repository to
   another server. Existing reviews stay on the server they were written to.

Outport says yes for a repository when it is registered on an Outport project
the signed-in person can see, and Outport's GitHub App is installed on it.

## 5. Review a pull request

1. Pick the pull request from the list. Gander clones the repository the first
   time, which takes a moment on a large one.
2. Read each file in the diff. Mark it reviewed with `m` or Space; `⇧J` marks it
   and moves to the next unmarked file.
3. Press `n` to capture a note about the selected line, or about the file. The
   notes panel (`⇧N`) lists them.
4. Press `?` for every key.

A checked file stays checked while its content is unchanged, so a rebase or a
force-push leaves the review alone. When a file really changes, it un-checks and
`d` shows only what changed since it was reviewed.

## 6. Connect an agent

Agents read the reviewer's notes and record what they did about each one, over
MCP on the same server.

### Outport

Outport serves the notes through its own MCP server, with the tools
`gander_get_review_notes`, `gander_mark_note_in_progress`,
`gander_mark_note_addressed`, `gander_resolve_note` and `gander_reopen_note`.
In Claude Code:

```bash
claude mcp add --transport http outport https://outport.app/mcp
```

Then run `/mcp` in Claude Code and sign in to Outport when asked. The `out`
command reads the same notes: `out gander notes list owner/name --prNumber 42`.

### A self-hosted server

```bash
claude mcp add --transport http gander https://gander.example.internal/mcp \
  --header "Authorization: Bearer $GANDER_TOKEN"
```

### Asking for the work

Ask the agent, in the pull request's checkout, to "read my Gander notes and
address them". A note moves through four states:

1. **open**: the reviewer wrote it.
2. **in progress**: an agent has started on it, or is waiting on the reviewer.
3. **addressed**: the agent recorded what it did, with a commit when code changed.
4. **resolved**: the reviewer accepted it. Re-checking the file in Gander
   resolves its addressed notes.

## When something goes wrong

| Message | What to do |
|---|---|
| **No GitHub token.** | Save a GitHub token (step 2), or sign in with `gh auth login` and restart Gander |
| **The service rejected that token.** (on Test) | The server token is wrong, revoked or expired: create a new one |
| Checkoffs or notes fail to save after a passing Test | On Outport, the token is Read: create a Write token and edit the server |
| **… is newer than this app understands** | Update Gander (**Check for Updates…**) |
| **… is too old for this app** | The server needs updating; for Outport, tell its maintainers |
| **\<repo\> is not reviewed on Outport.** (to an agent) | The repository saves to another server: give the agent that server's tools, or change the repository's server in Settings |
| Cloning fails | Check that plain `git clone` of the repository works in a terminal; Gander uses the same `git` and credentials |
