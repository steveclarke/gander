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

To update: `git pull && docker compose up -d --build`.

## Point the app at it

The app reads `GANDER_SERVICE_URL` and `GANDER_TOKEN` from the environment,
falling back to `serviceUrl` and `serviceToken` in its config file. Either works;
the environment wins.

```bash
GANDER_SERVICE_URL=https://gander.example.internal GANDER_TOKEN=… bin/dev
```

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
