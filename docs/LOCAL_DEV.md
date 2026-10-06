# Local development (and Google Cloud Shell)

One command starts everything:

```bash
pnpm dev:all
```

It builds the shared packages, starts PostgreSQL in Docker, waits for it, applies
migrations, seeds fake demo data, then runs the **API**, the **job worker** and the
**web app** with prefixed output in one terminal. `Ctrl-C` stops all three.

```
[dev   ] building workspace packages (@pms/calendar, @pms/shared, @pms/i18n)
[dev   ] docker compose up -d postgres
[dev   ] pnpm --filter @pms/api db:deploy
[dev   ] pnpm --filter @pms/api db:seed
[api   ] pms-api listening {"port":4000}
[worker] worker started {"queues":["charges.generate","charges.overdue-sweep","notifications.send"]}
[web   ] ▲ Next.js 15.5.27 → http://0.0.0.0:3000
[dev   ] ready: web :3000 · api :4000 · demo owner@demo.test / DemoPass123
```

Two steps exist because a clean clone cannot run without them, and both used to be
missing:

- **`@pms/*` are built first.** The apps import their _compiled_ output
  (`packages/*/dist`), which a fresh clone does not have. `pnpm dev:all` builds them
  and fails loudly if that build fails.
- **The Prisma client is generated on install.** `apps/api` has a `postinstall` that
  runs `prisma generate`, and `pnpm dev:all` runs it again before migrating, because
  not every package manager runs dependency build scripts.

Editing a package while the stack runs? Pass `--watch-packages` and `tsc --watch`
rebuilds `@pms/*` as you type (one extra process; skip it on a small VM and re-run
`pnpm dev:all` instead).

| URL                                   | What                                    |
| ------------------------------------- | --------------------------------------- |
| `http://localhost:3000`               | web app (the only port a browser needs) |
| `http://localhost:4000/api/v1/health` | API health check                        |
| `owner@demo.test` / `DemoPass123`     | demo login — **fake data only**         |

Useful flags: `--port <n>` (web port), `--skip-docker`, `--skip-seed`,
`--skip-install`, `--skip-worker`, `--watch-packages`. Memory knobs: `API_HEAP_MB`,
`WORKER_HEAP_MB` and `WEB_HEAP_MB` (sized automatically from the machine's RAM).

```bash
WEB_PORT=8080 pnpm dev:all        # different port
API_HEAP_MB=512 WEB_HEAP_MB=1024 pnpm dev:all   # if you have memory to spare
```

Prefer separate terminals? `pnpm db:deploy && pnpm db:seed`, then `pnpm dev`
(Turborepo, both apps — it builds the `@pms/*` packages first), `pnpm worker`,
`pnpm db:studio`.

---

## Google Cloud Shell

Cloud Shell gives you a Debian VM with Node, Docker and `git` preinstalled, a 5 GB
persistent home directory, and a Web Preview proxy that publishes a port over HTTPS
to your Google account only. **No Cloud Shell setup, no firewall rules, no
localhost tunnels.**

### 1. One-time setup

```bash
# 1. Node 20+ via corepack (pnpm is pinned in package.json)
node -v                # 20 or newer
corepack enable && corepack prepare pnpm@9.15.4 --activate

# 2. Clone. The repository is private: authenticate with YOUR GitHub account.
git clone https://github.com/michaeltsige/property-management-system-et.git
cd property-management-system-et
#    (HTTPS asks for a username and a token/password the first time. Use a
#     fine-grained token with read access to this repository. Never paste a token
#     into a URL, a file, or a commit.)

# 3. One env file, at the repository root
cp .env.example .env
#    Generate real secrets for anything you change:
#      openssl rand -base64 48   -> JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
#      openssl rand -base64 32   -> FIELD_ENCRYPTION_KEY

# 4. Install (a few minutes on the first run)
pnpm install
```

### 2. Run it

```bash
tmux new -A -s pms      # optional but recommended: survives a dropped connection
pnpm dev:all
```

The first run pulls the PostgreSQL image and seeds the demo organization. Then:

1. Click **Web Preview** in the Cloud Shell toolbar → **Change port** → `3000`.
   (Any port from **2000 to 65000** is allowed; 3000 is what `dev:all` uses.)
2. The preview opens at `https://3000-<your-vm>.cloudshell.dev`.
3. Sign in with `owner@demo.test` / `DemoPass123`.

The URL is also derivable in the terminal:

```bash
echo "https://3000-$WEB_HOST"     # $WEB_HOST is set by Cloud Shell
```

**Only port 3000 is published.** The browser calls `/api/v1/...` on that origin and
route handlers in `apps/web/src/app/api/` forward the call to the Express API on
`127.0.0.1:4000` (`API_PROXY_TARGET`). The API port is never exposed to the browser,
so nothing in the front end hardcodes `localhost`.

**The browser never holds a token and never sends an `Authorization` header.** It
gets an HttpOnly session cookie instead; the Next.js server reads that cookie and
adds `Authorization: Bearer …` on the way to the API. This is why Web Preview needs
no `CORS_ORIGINS` entry — every browser request is same-origin, and the call to the
API is server-to-server. See ADR-0026 for the full design (session endpoints, CSRF,
cookie flags, refresh handling).

| Browser calls                   | What happens                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/session/{login,register}` | Forwards to the API, stores `pms_at` / `pms_rt` as **HttpOnly** cookies (`SameSite=Lax`, `Path=/`, `Secure` when the browser used https), returns **only** `{ user, organization }` — never tokens. |
| `/api/session/me`               | Returns the current identity, or `401 NO_SESSION`.                                                                                                                                                  |
| `/api/session/{refresh,logout}` | Rotates or clears the cookies.                                                                                                                                                                      |
| `/api/v1/<anything else>`       | Forwards with the cookie's token as a Bearer header; on `401` it refreshes **once on the server** and replays the request.                                                                          |

`POST /api/v1/auth/login`, `/auth/register` and `/auth/refresh` are **not reachable
from the browser** — they return `404 NOT_PROXIED`, because those are the three
responses that contain tokens.

State-changing requests through the proxy must send `X-Requested-With: XMLHttpRequest`,
which the web client does on every non-GET call; the proxy also checks `Origin` when
the browser sends one. If you point the app at a hostname the Node process cannot
guess — some tunnel that rewrites the host — set `APP_ORIGIN=https://your-host` in
`.env`. Behind Cloud Shell's proxy you should not need to.

Check the API from the Cloud Shell terminal (server-side is fine — the API still
takes plain Bearer tokens):

```bash
curl -s localhost:4000/api/v1/health
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@demo.test","password":"DemoPass123"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["tokens"]["accessToken"])')
curl -s localhost:4000/api/v1/auth/me -H "Authorization: Bearer $TOKEN" | head -c 200
```

To check the browser path from the terminal, use the session endpoint (it needs the
custom header and an `Origin` the proxy will accept):

```bash
curl -si -X POST localhost:3000/api/session/login \
  -H 'content-type: application/json' -H 'x-requested-with: XMLHttpRequest' \
  -H 'origin: http://localhost:3000' \
  -d '{"email":"owner@demo.test","password":"DemoPass123"}' | head -20
```

### 3. Five-minute check in Web Preview

Run through this once after any change to `apps/web/src/lib/server/` or the `/api/`
route handlers. Nothing else exercises the real proxy in front of Cloud Shell.

1. Sign in with `owner@demo.test` / `DemoPass123` → you land on `/dashboard`.
2. **Dashboard shows real numbers** (ETB amounts, occupied units) — not zeros and not
   an error box. This is the one that fails when the browser cannot authenticate.
3. Press **F5** → still signed in, no flash of the login page.
4. Open another page with a list on it (Leases, Payments) → rows load.
5. Record a payment, or edit and save anything → the save succeeds.
6. **Sign out** → back at `/login`; press F5 → still at `/login`.
7. DevTools → Application → Cookies: `pms_at` and `pms_rt` are there and **HttpOnly**.
   `localStorage` holds no token, and no request in the Network tab has an
   `Authorization` header.

If step 2 fails with `Failed to fetch` and the Network tab shows the request never
reaching the API, the edge is interfering with the browser's requests themselves
(not just with headers) — stop and report it with the screenshot; that is a
different bug from the one ADR-0026 fixes.

### 4. When the VM resets (it will)

Cloud Shell **terminates the VM after ~40 minutes of inactivity** (12 h maximum
session, 50 h per week). Everything outside `$HOME` is gone; the 5 GB home
directory — your clone, `node_modules`, `.env` — persists.

| After a reset                                              | What to do                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker daemon not running                                  | `pnpm dev:all` starts it itself (`sudo service docker start` under the hood). Manually: `sudo service docker start`.                               |
| Postgres container gone                                    | Recreated by `pnpm dev:all`; migrations and the seed run again automatically.                                                                      |
| Database volume lost (Docker volumes live outside `$HOME`) | Nothing to do — the schema is rebuilt from the migrations and the demo data is re-seeded. **Never keep data you care about in the dev container.** |
| Port 3000 already in use                                   | `pkill -f "next dev"` (or `WEB_PORT=3001 pnpm dev:all` and preview that port).                                                                     |
| `pnpm: command not found`                                  | `corepack enable && corepack prepare pnpm@9.15.4 --activate`.                                                                                      |
| Reconnecting after hours                                   | `cd ~/property-management-system-et && tmux new -A -s pms` then `pnpm dev:all`.                                                                    |

Recovery is always the same two lines:

```bash
cd ~/property-management-system-et && pnpm dev:all
```

### 5. Keeping Cloud Shell comfortable

The VM is small. The defaults here are chosen for it: capped Node heaps (384 MB for
the API and worker, 768 MB for the web dev server), Next.js telemetry disabled, and
a Postgres container tuned with small buffers (`shared_buffers=128MB`,
`mem_limit: 384m`) and relaxed durability — that data is throwaway by design.

Realistic footprint with all three processes running: **web ~600 MB** (that is the
webpack dev server; it is the largest item by far), **api ~150 MB**, **worker
~100 MB**, Postgres ~150 MB. On a machine where that does not fit, run
`pnpm dev:all --skip-worker` (cron-style jobs can wait) and raise
`WEB_HEAP_MB` only if you actually hit a JavaScript heap error.

```bash
free -h                       # watch memory
df -h ~                       # 5 GB home disk
docker system prune -af       # reclaim space if images pile up
pnpm store prune              # reclaim the pnpm store
```

**`pnpm build` is a different story.** A production Next.js build needs ~1 GB peak and
may be OOM-killed on the smallest VMs. Stop the dev stack first (`Ctrl-C`) and give it
a heap bound, which forces earlier GC and a smaller peak:

```bash
NODE_OPTIONS=--max-old-space-size=768 pnpm build
```

Cloud Shell is a preview environment: `pnpm dev:all` is the intended workflow there,
and CI is where production builds are verified.

### 6. Before you push

```bash
pnpm format          # Prettier
pnpm lint            # ESLint, all workspaces
pnpm typecheck       # tsc --noEmit, all workspaces
pnpm test            # Vitest; the API suite needs the *_test database (docker compose creates it)
```

`pnpm test` refuses to run against a database whose name does not end in `_test` —
that guard is deliberate. `docker compose up -d` creates both `pms_dev` and
`pms_test`.

---

## Troubleshooting

| Symptom                                               | Cause and fix                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot connect to the Docker daemon`                 | `sudo service docker start`, then re-run `pnpm dev:all`. If Docker is genuinely unavailable, start any PostgreSQL 15+ and run `pnpm dev:all --skip-docker`.                                |
| `PostgreSQL never became reachable on localhost:5432` | Something else holds the port, or the container is unhealthy: `docker compose ps`, `docker compose logs postgres`.                                                                         |
| Web preview shows a blank page or an asset error      | The dev server must be reachable from outside the VM: `pnpm dev:all` binds `0.0.0.0` (never `127.0.0.1`). Cloud Shell hostnames are pre-allowed in `next.config.ts` (`allowedDevOrigins`). |
| `EADDRINUSE`                                          | Another process holds 3000/4000: `pkill -f "next dev"`, `pkill -f "tsx watch"`.                                                                                                            |
| Login returns 401 with the seeded credentials         | The database has no demo data (or was recreated): `pnpm db:seed:force`.                                                                                                                    |
| Changes to the demo data keep coming back             | `pnpm db:seed` is idempotent and stops when the demo organization exists; run it only with `--force` when you want a clean slate.                                                          |
| The API cannot find a variable you set in `.env`      | The API reads the root `.env` and `apps/api/.env`; real environment variables always win over both. Restart the API after editing.                                                         |

## Why the browser never calls the API directly

`apps/web/src/lib/api.ts` uses relative URLs (`/api/v1/...`) only, and route handlers
in `apps/web/src/app/api/` forward those server-side to `API_PROXY_TARGET` (default
`http://127.0.0.1:4000`). One origin in every environment; no hostname in the bundle;
no `localhost` in a browser request; a single port to publish behind Cloud Shell, a
tunnel, or a load balancer.

The same handlers are where the session lives (ADR-0026): the tokens stay in
HttpOnly cookies the JavaScript cannot read, and the `Authorization: Bearer` header
is added by the server, not by the browser. A proxy that rewrites or strips request
headers therefore cannot break authentication — it never sees one — and a token
cannot leak through the front end, because there is none in it.

Direct API access is unaffected: the Express API still authenticates `Bearer` tokens
for scripts, `curl` and the future mobile app.
