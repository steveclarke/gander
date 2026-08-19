# The review service, for a host that is not a development checkout.
#
# Runs the TypeScript sources under tsx, the same way the dev stack does. The
# service is small and has no build step of its own; adding one here would mean
# two ways to run the same code and one of them going stale.

FROM node:24-slim AS deps

# better-sqlite3 ships prebuilds for glibc Node; these are the fallback for a
# platform without one.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/service/package.json packages/service/
# The workspace root's postinstall hook runs even for a service-only install.
COPY bin/repair-electron bin/
RUN pnpm install --frozen-lockfile --filter @gander/service...

FROM node:24-slim AS runtime
WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/packages/service/node_modules packages/service/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared packages/shared
COPY packages/service packages/service

# The database is the only state, and it belongs to the volume rather than the image.
ENV GANDER_HOST=0.0.0.0 \
    GANDER_PORT=8390 \
    GANDER_DB=/data/gander.db
VOLUME ["/data"]
EXPOSE 8390

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GANDER_PORT??8390)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx directly rather than through pnpm: corepack resolves and downloads a package
# manager on first run, which made starting the container need the network and the
# npm registry to be up.
WORKDIR /app/packages/service
CMD ["node_modules/.bin/tsx", "src/main.ts"]
