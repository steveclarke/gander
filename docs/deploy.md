# Running the review service on a host

The app derives everything it shows from Git and GitHub. The service holds the
part you author: which files you have checked off, the content you checked them
against, and your questions.

Run it in a development checkout and that state lives on one machine, reachable
only while a dev stack happens to be up. Run it on a host and a review is
readable from any machine you review from, and agents reach your questions
whether or not a window is open anywhere.

One reviewer, one token. The service is not built to be internet-facing: put it
on a private network or a VPN, or behind a proxy with an access rule.

## Bring it up

Docker and a host on your network are the only requirements.

```bash
git clone https://github.com/steveclarke/gander.git
cd gander

printf 'GANDER_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
chmod 600 .env

docker compose up -d --build
curl -s http://127.0.0.1:8390/healthz     # {"ok":true,"version":"..."}
```

| Setting | Default | |
|---|---|---|
| `GANDER_TOKEN` | — | Required. Guards the API and the MCP endpoint alike |
| `GANDER_PUBLISH_PORT` | `8390` | Host port, when 8390 is taken |

The database is a SQLite file on the `gander-data` volume, at `/data/gander.db`.
It is the only state; back up the volume and you have backed up every review.

To update by hand: `git pull && docker compose up -d --build`.

`bin/deploy` does the same over ssh, then waits for the container and checks that
what came back answers the contract version the deployed ref declares — a service left
behind the app is the failure worth catching at deploy time rather than mid-review:

```bash
export GANDER_DEPLOY_HOST=docker.example.internal   # ssh destination
export GANDER_DEPLOY_PATH=/home/deploy/docker/gander  # optional, this is the default
bin/deploy                 # master
bin/deploy --ref v0.2.0    # a tag
```

## Point the app at it

In the installed app, open **Settings → Connection**, enter the hosted URL and
token, then test and save the connection.

From a development checkout, use the checkout-local settings and start the app
without its local service:

```bash
bin/dev --hosted
```

On the first run, enter and save the same connection under **Settings →
Connection**. It is stored in the gitignored `.gander/config.json` with
owner-only permissions. Hosted mode does not accept the URL or token on its
command line or from exported variables, which keeps the pair out of shell
history and makes their source unambiguous. Ordinary `bin/dev` continues to
override the saved connection with its generated checkout-local values.

## Point an agent at it

Agents read your questions over MCP at `/mcp` on the same service, with the same
token. Registered once against a hosted service, rather than per checkout:

```bash
claude mcp add --transport http gander https://gander.example.internal/mcp \
  --header "Authorization: Bearer $GANDER_TOKEN"
```

## Keep the details together

The URL and the token are needed on every machine you review from, and by every
agent you want reading your questions. Keep them in your password manager as one
item, with the `claude mcp add` line written out — then setting up a new machine
is reading one card rather than reconstructing a deployment.

## Building the app

`pnpm --filter @gander/app run dist:unsigned` produces an unsigned
`dist/mac-arm64/Gander.app` — enough to run what a package will contain.

A release is `bin/release <version>`: it tags, creates the GitHub Release,
builds and notarizes the macOS artifacts on the maintainer's machine, and
uploads them. The Linux AppImage is built by GitHub Actions when the release is
published. macOS signing stays local because the certificate belongs in a
keychain rather than in a public repository's secrets.

The packaged app uses the `latest-mac.yml` and `latest-linux.yml` files from the
release. It checks once after opening its first window and also offers a manual
check in the native application menu. Updates download automatically, but
`autoInstallOnAppQuit` is disabled: the reviewer must choose **Restart and
Install** after the download completes. Development builds and unsigned
directory builds, which have no generated `app-update.yml`, do not initialize
the updater; Linux additionally requires the `APPIMAGE` runtime path.

The first real update between two signed releases still needs manual acceptance
on both platforms. On macOS, verify that the old and new builds use the same
Developer ID identity and that the downloaded update installs after consent. On
Linux, launch the old AppImage as an AppImage (so `APPIMAGE` is present), accept
the update, and verify the file and running version changed. A local unsigned
build or a successful unit test is not evidence for either cross-version path.

### Homebrew cask handoff

`bin/release` renders `packages/app/dist/gander.rb` from the versioned macOS DMG,
pins its SHA-256, and uploads it as a release asset. The cask deliberately uses
the DMG for installation; the ZIP remains the macOS updater artifact.

The personal tap is a separate public repository and is not managed here. After
the release and its install/update path have been verified manually:

1. Copy the release's `gander.rb` into `Casks/gander.rb` in the tap.
2. Run `brew style --cask Casks/gander.rb` and
   `brew audit --cask --strict Casks/gander.rb` there.
3. Install the fully qualified cask from the tap and launch it before publishing
   the tap change.

The cask is the installation and discovery path; Electron's consent-based updater
owns routine upgrades. `auto_updates true` keeps an ordinary `brew upgrade` from
replacing an app that updates itself. The tap still advances with each verified
release so a fresh Homebrew installation receives the current version.

Do not copy signing identities, notarization credentials, tokens, or keychain
profile names into either repository. The generated cask contains only the
public release URL and checksum.
