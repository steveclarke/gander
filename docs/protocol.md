# The Gander protocol

The Gander app talks to a review server over HTTP, and agents talk to the same
server over MCP. This document describes both, for anyone writing a server or a
client. It describes contract **0.11.0**.

The source of truth is the code:

- `packages/shared/src/index.ts` defines every payload as a Zod schema;
- `packages/service/contract.json` is a generated snapshot of the routes, the
  JSON Schemas of those payloads and the MCP tools. A test fails when the running
  service and the snapshot disagree.

## The model

The app derives everything it shows from Git and GitHub: clones, diffs, pull
request lists. The server keeps only what the reviewer authors, keyed by
repository and pull request:

- **checkoffs**: one per file, recording whether the reviewer has checked it and
  the content it was checked against;
- **snapshots**: the two sides of the diff at the time of the checkoff, used to
  show what changed since the review;
- **notes**: remarks the reviewer leaves for an agent, on a line, a file or the
  whole pull request;
- **pull request context**: branch, title, head commit and stack position,
  recorded by the app so an agent can be told which pull request it is on.

A checkoff is content-based. It stores the SHA-256 (lowercase hex) of the raw
bytes of each side of the diff. A file stays checked while its content matches,
so a rebase or force-push does not disturb a review. When the content changes,
the app shows the file as unchecked and diffs the new content against the
snapshot. Un-checking a file keeps its hashes and snapshot: a missing snapshot
means "never reviewed", not "unchanged".

## Versioning

`GET /healthz` returns the server's contract version. The app compares it with
the version it was built for, `SERVICE_VERSION`:

| Server version | The app |
|---|---|
| The same | Connects |
| Same major and minor, newer patch | Connects |
| 0.9.x or 0.10.x | Connects, without the features added since: 0.9 servers get single-file writes instead of batches; servers before 0.11 claim no repositories |
| Older otherwise | Refuses: "too old for this app" |
| Newer minor or major | Refuses: "newer than this app understands" |

A change to the contract (a route added or removed, a field the app comes to rely
on) bumps the version in the same change, then `bin/contract-snapshot` records it.

## HTTP

### Conventions

- All paths are relative to the configured service URL, which may include a path
  prefix (for example `https://reviews.example.com/gander`).
- Every route except `/healthz` requires `Authorization: Bearer <token>`. A
  missing or wrong token answers `401 {"error": "missing or invalid bearer token"}`.
- `:repoId` is `owner/name`, URL-encoded as one segment: `acme%2Fatlas`. A server
  behind a proxy that decodes `%2F` must still accept it.
- `:prNumber` and note `:id` are positive integers. Anything else answers `400`.
- Errors are JSON: `{"error": "<what was wrong>"}`. A rejected body lists every
  failing field.
- Bodies are JSON. The two file routes accept up to 16 MiB; other routes accept
  up to 1 MiB. A larger body answers `413`.
- Reading a review that does not exist returns an empty review, not `404`.

### Routes

| Method and path | Body | Answer |
|---|---|---|
| `GET /healthz` | | `{"ok": true, "version": "0.11.0"}`, without authentication |
| `GET /api/repositories/claim?remote=<git remote URL>` | | `{"claimed": true \| false}`; `400` when `remote` is missing |
| `GET /api/reviews/:repoId` | | `ReviewState[]`: every pull request in the repository with checkoffs |
| `GET /api/reviews/:repoId/:prNumber` | | `ReviewState` |
| `PUT /api/reviews/:repoId/:prNumber/files` | `PutFileState` | `FileCheckoff` |
| `PUT /api/reviews/:repoId/:prNumber/files/bulk` | `{"files": PutFileState[]}` | `FileCheckoff[]` |
| `GET /api/reviews/:repoId/:prNumber/snapshot?path=<file path>` | | `{"baseContent", "headContent"}`, both `null` when the file was never reviewed |
| `PUT /api/reviews/:repoId/:prNumber/context` | `PrContext` | `204` |
| `GET /api/reviews/:repoId/:prNumber/notes` | | `Note[]`, in note-number order |
| `POST /api/reviews/:repoId/:prNumber/notes` | `NewNote` | `201`, `Note` |
| `PATCH /api/reviews/:repoId/:prNumber/notes/:id` | `UpdateNote` | `Note`; `404` when there is no such note |
| `DELETE /api/reviews/:repoId/:prNumber/notes/:id` | | `204`; `404` when there is no such note |
| `/mcp` | | MCP, below |

The app tests a connection by reading `GET /healthz`, then
`GET /api/reviews/gander%2Fconnection-check/1` with the token: `401` there means
the token was rejected.

### Writing checkoffs

`PutFileState` either checks a file or un-checks it:

```json
{ "checked": true, "path": "src/app.ts",
  "baseHash": "9f86d0…", "headHash": "60303a…",
  "baseContent": "…", "headContent": "…", "machine": "laptop" }
```

```json
{ "checked": false, "path": "src/app.ts" }
```

- A hash or content is `null` when the file does not exist on that side (an added
  or deleted file).
- `machine` names the computer the checkoff came from; the server records it with
  the time.
- Checking a file resolves that file's **addressed** notes: the reviewer looking
  again is the reviewer accepting the work. Open and in-progress notes stay.
- Un-checking keeps the stored hashes and snapshot.

`files/bulk` applies up to 500 entries atomically. The server validates the whole
body first and writes nothing when any entry is invalid (`400`). Entries apply in
order, so a repeated path takes its last entry. The answer has one `FileCheckoff`
per entry, in input order. A client splits larger sets at 500 entries and before
the body passes 16 MiB, and shows a file as saved only after its batch succeeds.

### Notes

A note has a global `id`, used in API paths and tool calls, and a `number`, scoped
to the pull request, never reused, used when people talk about it ("note 3").

`NewNote`:

| Field | |
|---|---|
| `path` | The file, or `null` for the whole pull request |
| `line` | 1-based line in the head revision, or `null` |
| `text` | The note |
| `headSha` | The head commit the reviewer was reading, or `null` |
| `sourceContext` | `{"startLine", "lines": [...]}`: the lines around the selected line, captured before the branch can move, or `null` |

A stored `Note` adds `id`, `number`, `state`, `inProgressNote`, `commitRef`,
`summary` and `createdAt`.

`UpdateNote` changes `text`, `state` or both; at least one is required.

### Note states

| State | Set by | Meaning |
|---|---|---|
| `open` | Reviewer, on capture | Needs work |
| `in_progress` | Agent | Work has started, or is waiting on the reviewer (`inProgressNote` says why) |
| `addressed` | Agent | Work is done; `summary` and optionally `commitRef` record the outcome |
| `resolved` | Reviewer | Accepted. Re-checking the file does this for addressed notes |

An agent can go straight from `open` to `addressed`. An agent cannot claim or
address a resolved note. Resolving and reopening happen on the reviewer's word,
from the app or by an agent the reviewer has told to.

### Pull request context

The app sends `PrContext` when it opens a pull request: `headRef`, `title`,
`headSha`, and `stackId`, `stackSize`, `stackPosition` for a pull request in a
GitHub stack (all three `null` otherwise). It lets an agent find a pull request
by branch name and see the rest of its stack.

### Repository claims

When a reviewer opens a repository, the app asks every configured server
`GET /api/repositories/claim?remote=<the repository's git remote>`:

- exactly one server answers `true`: the app uses it without asking;
- none or several answer `true`, or a server cannot be reached: the app asks the
  reviewer once.

The app remembers the answer per repository and does not ask again. The remote
is sent whole (HTTPS, SSH or `git@host:owner/name` form), so a fork and its
upstream can belong to different servers. A remote the server cannot parse
answers `false`, not an error.

The standalone service claims every repository unless `GANDER_CLAIM_OWNERS` lists
the owners it covers (`docs/deploy.md`).

## MCP

`/mcp` is an MCP server over streamable HTTP, stateless (no session id), with the
same bearer token. It has five tools.

| Tool | Arguments | Does |
|---|---|---|
| `get_review_notes` | `repo` (required), `prNumber` or `branch`, `includeAddressed`, `includeResolved`, `since` | Lists notes; open and in-progress by default |
| `mark_note_in_progress` | `id`, optional `note` | Claims a note; `note` says what it waits on |
| `mark_note_addressed` | `id`, `summary`, optional `commitRef` | Records the outcome |
| `resolve_note` | `id` | Resolves, only on the reviewer's word |
| `reopen_note` | `id` | Reopens, only on the reviewer's word |

`get_review_notes` answers with one JSON text block:

```json
{
  "repo": "acme/atlas",
  "prNumber": 42,
  "branch": "fix-login",
  "title": "Fix the login redirect",
  "headSha": "4b825d…",
  "lastNoteId": 17,
  "noteCounts": { "open": 1, "in_progress": 0, "addressed": 2, "resolved": 0 },
  "message": "Returned 1 of 3 notes on this pull request.",
  "stack": null,
  "notes": [
    { "id": 17, "number": 3, "file": "src/login.ts", "line": 12,
      "text": "Why not reuse the session helper?", "state": "open",
      "capturedAtSha": "4b825d…",
      "sourceContext": { "startLine": 10, "lines": ["…"] },
      "lineMayHaveMoved": false }
  ]
}
```

- `noteCounts` always counts every state, and `message` says when notes were
  hidden and which flag shows them.
- `lineMayHaveMoved` is true when the branch has moved since the note was
  captured.
- `stack`, for a stacked pull request, gives its `position`, `size` and
  `members` (each with `prNumber`, `branch`, `title`, `position`, `openNotes`).
  When this pull request has no open notes but a sibling does, the answer adds a
  line naming it.
- `since` returns only notes with a greater `id`; pass the last `lastNoteId` to
  poll for new notes.
- With `branch` and no `prNumber`, the server looks for the newest pull request
  on that branch that the app has opened. One never opened in Gander is an error
  saying so.
- A server asked about a repository it does not claim, and has nothing stored
  for, answers with an error ("`acme/atlas` is not reviewed on this server.")
  rather than an empty list, so an agent does not mistake it for a clean review.
  With `GANDER_OTHER_SERVER` set, the error names where its reviews live.

Errors (an unknown note id, a resolved note an agent tries to claim) come back as
tool results with `isError: true` and a sentence saying what was wrong.

## Other servers

A server implements this contract by serving the routes above with the same
payloads, under any URL prefix, and reporting a version the app accepts.
Outport serves it at `https://outport.app/gander`, with per-person private
reviews. Its agent tools are on its own MCP server, under the names
`gander_get_review_notes`, `gander_mark_note_in_progress`,
`gander_mark_note_addressed`, `gander_resolve_note` and `gander_reopen_note`,
with the same arguments.
