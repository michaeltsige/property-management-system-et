# syntax=docker/dockerfile:1
#
# One build, three runnable images — deploy the target you need:
#
#   docker build --target api    -t pms-api .
#   docker build --target web    -t pms-web .
#   docker build --target worker -t pms-worker .   (same tree as api, runs the scheduler)
#
# All targets run on node:20-bookworm-slim (glibc — matches the Prisma engines
# and @node-rs/argon2 binaries built below). Every target honours the platform-
# injected $PORT: the API reads PORT as a fallback for API_PORT (config.ts),
# the web command passes it to `next start`.
#
# Linux (WSL) only: build inside Ubuntu, never from Windows — the dependency
# tree resolves platform-specific binaries at install time.

# ---------------------------------------------------------------------------
# build: full workspace install + compile, then prune into deploy trees
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build
ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# 1) install from the lockfile (dev deps included — the build needs them)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/calendar/package.json packages/calendar/
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN corepack pnpm install --frozen-lockfile

# 2) build everything from source
COPY . .
RUN corepack pnpm -r --filter='./packages/*' run build \
 && corepack pnpm --filter @pms/api db:generate \
 && corepack pnpm --filter @pms/api run build \
 && corepack pnpm --filter @pms/web run build

# 3) prune into deploy trees. `pnpm deploy --legacy --prod` hard-links a
#    minimal dependency tree; COPY --from=build materialises it as real files.
#    - the api package's postinstall generates the Prisma client into the
#      SOURCE store, so it is copied across into the deployed store (same
#      lockfile, same store hash);
#    - the web tree ships a pre-transpiled next.config.js because the source
#      config is TypeScript and the pruned tree has no typescript;
#    - `.next/cache` is a build-time cache, never needed at runtime.
RUN npm i -g "prisma@$(node -p "require('./apps/api/node_modules/@prisma/client/package.json').version")" \
 && corepack pnpm --filter @pms/api deploy --prod --legacy /out/api \
 && cp -a /repo/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma \
          /out/api/node_modules/.pnpm/@prisma+client@*/node_modules/ \
 && corepack pnpm --filter @pms/web deploy --prod --legacy --ignore-scripts /out/web \
 && rm -rf /out/web/.next/cache \
 && ./node_modules/.bin/tsc apps/web/next.config.ts --module commonjs --target es2020 \
      --esModuleInterop --skipLibCheck --outDir /tmp/cfg \
 && mv /tmp/cfg/next.config.js /out/web/next.config.js \
 && rm /out/web/next.config.ts

# ---------------------------------------------------------------------------
# api: Express + Prisma (also honours PORT via config.ts)
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api ./
EXPOSE 4000
CMD ["node", "dist/server.js"]

# ---------------------------------------------------------------------------
# worker: same tree as api, runs the pg-boss scheduler instead of the server.
# Note: the worker is what delivers tenant-portal OTP codes and runs the
# nightly charge/overdue schedules — omit it only for pure admin demos.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api ./
CMD ["node", "dist/worker.js"]

# ---------------------------------------------------------------------------
# web: Next.js server (prebuilt). Shell form on purpose: $PORT expansion.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/web ./
EXPOSE 3000
CMD node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}
