# GitHub authentication decision

Status: approved for follow-up implementation

Decision date: 2026-08-18

## Decision

Gander will add built-in GitHub.com sign-in using a **GitHub App user access
token obtained through GitHub's device flow**. The GitHub App will request only
read access to repository metadata and pull requests, use expiring user access
tokens, and store access and refresh tokens through Electron's OS-backed
`safeStorage` API.

This issue is an investigation, not the OAuth implementation. The slices below
are deliberately separate follow-up work.

## What the app requires today

The desktop runtime does not require the GitHub CLI. `github.ts` calls the
GitHub REST API directly for repository and pull-request data. It resolves a
token in this order:

1. `GANDER_GITHUB_TOKEN`
2. `githubToken` in Gander's config
3. `gh auth token`, trying common package-manager locations as well as `PATH`

If neither of the first two sources is configured and `gh` is absent or logged
out, GitHub-backed views fail with an actionable missing-token error. No other
normal desktop workflow invokes `gh`. Developer-only worktree and release
scripts do invoke it; those scripts are not part of the packaged app runtime.

The `git` executable remains a runtime requirement by design. Cloning and
fetching private repositories use Git's own credential helper; the GitHub API
token is not injected into Git commands.

The current manual Settings token is an acceptable temporary compatibility
path, but not the target sign-in experience. It is plain text in a config file
whose directory and file modes are forced to `0700` and `0600`. File permissions
reduce accidental disclosure but are not a substitute for an OS credential
store.

## Why a GitHub App

A traditional OAuth App is a poor fit for a read-only reviewer. Public data can
be read with no OAuth scope, but private repository access requires the OAuth
`repo` scope. GitHub defines that scope as full read and write access to public
and private repositories; even `public_repo` includes write capabilities. Gander
must not ask for mutation privileges it does not use.

A GitHub App has fine-grained permissions. The endpoints Gander uses accept a
GitHub App user access token with:

- **Metadata: read**, for `GET /user/repos`
- **Pull requests: read**, for `GET /repos/{owner}/{repo}/pulls`

No Contents permission, webhook subscription, private key, or installation
token is required for the current API calls. Repository installation remains
necessary: the user or organization installs Gander for all or selected
repositories, and the user access token can see only the intersection of that
installation, the app's permissions, and the user's own access.

This makes installation an explicit part of first-run UX. Gander must explain
the difference between authorizing the user and installing the app, show a
useful empty state when no installations or repositories are accessible, and
link to the GitHub installation page.

## Why device flow

Gander is a distributed native client and cannot keep a client secret. GitHub's
device flow needs only the public client ID for initial authorization and for
later refreshes of tokens created by that flow. It also avoids a custom URL
scheme, loopback callback listener, and mandatory hosted token-exchange service.

GitHub recommends authorization-code flow with PKCE over device flow when a
public client can use it, because device flow can be abused for remote phishing.
GitHub's code exchange nevertheless requires the app's client secret; embedding
that secret in a public Electron bundle would not make it secret. A hosted
exchange service would add an operational dependency that Gander otherwise does
not need. Device flow is therefore the bounded choice for the first built-in
sign-in slice.

The UI must mitigate the phishing risk:

- start authorization only from an explicit **Sign in to GitHub** action
- accept authorization and token endpoints only from the configured GitHub host
- show the host and user code in Gander, then open the returned verification URL
  in the system browser
- never ask the user to paste a GitHub password, token, or browser result into
  Gander
- obey GitHub's returned expiry and polling interval; handle
  `authorization_pending`, `slow_down`, cancellation, denial, and expiry
- validate every newly issued identity with `GET /user` before associating it
  with stored account metadata

## Registration and distribution

For GitHub.com, the maintainer will register one public GitHub App owned by the
project's durable account or organization. Its client ID is public configuration
and may be compiled into release builds. Registration must enable device flow,
keep user-to-server token expiration enabled, request only Metadata read and
Pull requests read, subscribe to no webhooks, and publish the repository URL as
its homepage and support location.

The app must be tested against personal repositories, selected-repository
installations, organization approval restrictions, and SAML SSO. For an
SSO-protected organization, GitHub requires an active SSO session during
authorization; Gander should surface the resulting access failure rather than
silently omitting a configured repository.

## Credential lifecycle

GitHub App user access tokens expire after eight hours by default. Their refresh
tokens expire after six months. Each successful refresh rotates both tokens and
invalidates the old pair, so the credential store update must be atomic. Refresh
before an authenticated request when expiry is near; coalesce concurrent refresh
attempts into one operation. An invalid or expired refresh token returns the
user to sign-in without deleting non-secret repository configuration.

Tokens belong in Electron's main process only. Store encrypted token material
with `safeStorage`; keep only non-secret host, account login, token expiry, and
credential version metadata in JSON. Renderer IPC must expose account state and
sign-in actions, never token values. Logs and errors must redact access tokens,
refresh tokens, device codes, and authorization headers.

On macOS, `safeStorage` protects its encryption key with Keychain. On Linux it
depends on the desktop secret service. Gander must detect an unavailable or
`basic_text` backend and refuse to persist built-in credentials, with a clear
remediation message; silently falling back to plaintext would break the security
claim.

**Sign out** deletes Gander's local access and refresh tokens. It cannot promise
server-side revocation: GitHub's app-token revocation endpoint requires the app
client secret, which must not ship in the desktop bundle. The UI must also offer
**Manage authorization on GitHub**, where the user can revoke the GitHub App and
all associated tokens. A `401 Bad Credentials` response after remote revocation
returns the app to signed-out state. Gander has no always-on webhook receiver, so
it learns about revocation on the next API request.

## Existing token fallbacks

Keep the existing sources, but make built-in credentials the normal interactive
path. The target resolution order is:

1. `GANDER_GITHUB_TOKEN` for explicit automation/test override
2. built-in, OS-protected GitHub App credential
3. configured manual token for advanced use and Enterprise transition
4. `gh auth token` as a convenience development fallback

Manual config tokens are deprecated once secure storage ships. Do not silently
migrate their plaintext values into the OS store: show the source and ask the
user to adopt built-in sign-in or explicitly save the existing token securely.
All sources must be labelled in Settings so the active credential is
predictable.

## GitHub Enterprise

GitHub Enterprise Cloud uses GitHub.com endpoints and the same public GitHub App,
subject to organization app approval and SAML SSO.

GitHub Enterprise Server is a separate deployment target, not something the
GitHub.com client ID can cover. Each server has its own web origin, REST base
(`https://HOSTNAME/api/v3`), app registration/client ID, installation policy,
and potentially private certificate authority. Although current code has a
`GANDER_GITHUB_API_URL` test override, it does not model the web authorization
origin, host-scoped credentials, or app registration. Built-in GHES sign-in must
therefore remain a distinct slice. Manual tokens and host-aware `gh` discovery
may remain the transition path, but credentials must always be keyed by host and
never sent to a different origin.

## Follow-up implementation slices

1. **Secure credential boundary.** Add a main-process credential-store
   interface, `safeStorage` implementation, Linux backend refusal, redaction,
   host-keyed account metadata, and real persistence/IPC tests. Stop returning
   the configured GitHub token to the renderer.
2. **GitHub.com registration and device sign-in.** Register the least-privilege
   GitHub App; implement explicit start/cancel, system-browser handoff, interval-
   correct polling, identity validation, and failure states with a local HTTP
   fake in tests.
3. **Installation-aware repository discovery.** Handle selected installations,
   organization approval/SSO failures, no-installation UX, and installation
   management links without adding GitHub write operations.
4. **Refresh, sign-out, and revocation UX.** Implement atomic rotation,
   single-flight refresh, restart persistence, local sign-out, remote-revocation
   detection, and the GitHub authorization-management link.
5. **Fallback cleanup.** Make credential precedence visible, retain environment
   and `gh` fallbacks, move explicitly accepted manual tokens into secure
   storage, then remove `githubToken` from the JSON config shape.
6. **GitHub Enterprise Server.** Add an explicit host model, per-host app/client
   registration, `/api/v3` and web-auth URL derivation, certificate validation
   guidance, host-aware `gh auth token --hostname`, and GHES integration tests.

Each slice must preserve the rule that GitHub integration is read-only and that
authentication and API failures surface their real, redacted error.

## Primary sources

Current official documentation reviewed on 2026-08-18:

- GitHub, [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- GitHub, [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- GitHub, [Best practices for creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- GitHub, [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- GitHub, [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- GitHub, [Repository API permissions](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user)
- GitHub, [Pull request API permissions](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests)
- GitHub, [OAuth authorization revocation endpoints](https://docs.github.com/en/rest/apps/oauth-applications)
- GitHub, [Authorizing OAuth apps with Enterprise Cloud](https://docs.github.com/en/enterprise-cloud@latest/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps)
- GitHub, [Registering a GitHub App on Enterprise Server](https://docs.github.com/en/enterprise-server@latest/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- Electron, [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
