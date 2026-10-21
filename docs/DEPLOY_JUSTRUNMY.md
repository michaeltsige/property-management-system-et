# Deploying to JustRunMy.App (and other small container hosts)

Practical guide for running the stack on [justrunmy.app](https://justrunmy.app).
Complements `PRODUCTION_RUNBOOK.md` (§1–§3), which covers the single-VPS path
with Caddy — read it for Postgres durability, secrets handling and HTTPS basics;
the same rules apply here.

## 1. What the free tier actually fits

Free tier (per the pricing page): **0.15 vCPU · 0.25 GB RAM · 0.3 GB disk · 1 app**,
automatic HTTPS. Billing beyond the baseline is per-minute usage aggregated
across apps (account caps: 1 vCPU / 2 GB RAM / 5 GB disk).

Measured production footprints of this app:

| Process                      | Resident memory (approx.) |
| ---------------------------- | ------------------------- |
| web (`next start`, prebuilt) | 120–180 MB                |
| api (Express + Prisma)       | 110–160 MB                |
| worker (pg-boss scheduler)   | 70–100 MB                 |
| PostgreSQL                   | 100–200 MB                |

**The whole stack (~400–500 MB) does not fit in 0.25 GB.** The free tier fits
exactly one lean service, and the API is the one that fits. Three honest ways
to run:

| Path                                   | Cost    | What runs where                                                              |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| A. Free split                          | $0      | Postgres on Neon (free) · API on JustRunMy free · web on Vercel Hobby (free) |
| B. One platform, paid                  | ~$2–3/mo| Postgres on Neon (free) · api + web + worker as three JustRunMy apps         |
| C. Single VPS                          | ~$4–5/mo| Everything on one box — `PRODUCTION_RUNBOOK.md`                              |

## 2. Build the images (WSL, not Windows)

The dependency tree resolves platform-specific binaries at install time
(Prisma engines, `@node-rs/argon2`). Build inside Ubuntu/WSL:

```bash
docker build --target api -t pms-api .
docker build --target web -t pms-web .
docker build --target worker -t pms-worker .   # same tree as api, runs the scheduler
```

Push to a registry the panel can pull from (GitHub Container Registry example):

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <your-github-user> --password-stdin
docker tag pms-api  ghcr.io/<your-github-user>/pms-api:latest
docker tag pms-web  ghcr.io/<your-github-user>/pms-web:latest
docker push ghcr.io/<your-github-user>/pms-api:latest
docker push ghcr.io/<your-github-user>/pms-web:latest
```

The platform also advertises Git and Zip deploys; for this monorepo, images are
the reliable route (the build needs a workspace-wide pnpm install).

## 3. The database: Neon (free)

1. Create a project at neon.tech (free tier: 0.5 GB, always free).
2. Copy both connection strings: the **pooled** one for the apps, the **direct**
   one for migrations.
3. From your WSL machine, apply the schema (and demo seed, if wanted):

```bash
DATABASE_URL="<direct-url>?sslmode=require" corepack pnpm --filter @pms/api db:deploy
DATABASE_URL="<direct-url>?sslmode=require" corepack pnpm --filter @pms/api db:seed   # demo data only
```

Never put real records behind a demo seed. See the seed's own warnings.

## 4. Path A — the $0 split

### 4.1 JustRunMy app #1: the API (free tier)

Create one app from the `pms-api` image; expose port **4000** (or set `PORT`
and expose that — the API honours both). Environment:

| Variable              | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`        | Neon **pooled** URL, `?sslmode=require`                      |
| `JWT_ACCESS_SECRET`   | `openssl rand -base64 48` (min 32 chars)                     |
| `JWT_REFRESH_SECRET`  | `openssl rand -base64 48` (different from access)            |
| `FIELD_ENCRYPTION_KEY`| `openssl rand -base64 32` (encrypts tenant ID numbers)       |
| `API_PUBLIC_URL`      | `https://<api-app-host>` (this app's public URL)             |
| `CORS_ORIGINS`        | `https://<web-host>`                                         |
| `APP_ORIGIN`          | `https://<web-host>`                                         |
| `PAYMENT_PROVIDER`    | `mock` (demo) or `chapa`                                     |
| `JOBS_ENABLED`        | `false` (no worker on the free tier)                         |
| `NODE_ENV`            | `production`                                                 |

Health check: `GET /api/v1/health` (liveness, no DB) — the panel should use it.

### 4.2 Vercel Hobby: the web app

Import the GitHub repo, set **Root Directory** to `apps/web`. Environment:

| Variable           | Value                                        |
| ------------------ | -------------------------------------------- |
| `API_PROXY_TARGET` | `https://<api-app-host>` (the JustRunMy API) |
| `NODE_ENV`         | `production`                                 |

The browser only ever talks to the web origin; the server-side proxy attaches
the session cookie's token to API calls (`docs/ARCHITECTURE.md`, ADR-0026), so
no CORS changes are needed beyond the table above.

### 4.3 What this path cannot do

- **No scheduled jobs** (`JOBS_ENABLED=false`): nightly charge generation,
  overdue sweeps and lease-expiry sweeps do not run. Demo data is unaffected.
- **No tenant-portal OTP**: portal login codes are delivered by the
  `notifications.send` worker job — without a worker, tenants cannot log in.
  The admin side is fully usable. Add the worker (Path B) when tenants matter.
- **Ephemeral uploads**: the free tier's 0.3 GB disk is not durable storage.
  Payment proofs and documents live on `STORAGE_DRIVER=local` at best until
  you switch to S3 (`STORAGE_DRIVER=s3`; Cloudflare R2 has a 10 GB free tier).

## 5. Path B — full stack on JustRunMy (~$2–3/mo)

Three apps from the images, sized inside the account caps (1 vCPU / 2 GB RAM):

| App    | Image           | RAM      | Port | Extra env vs Path A                     |
| ------ | --------------- | -------- | ---- | --------------------------------------- |
| api    | `pms-api`       | 0.4–0.5GB| 4000 | `JOBS_ENABLED=false` (worker owns jobs) |
| worker | `pms-worker`    | 0.25 GB  | —    | `JOBS_ENABLED=true`, DB URL, cron env   |
| web    | `pms-web`       | 0.5 GB   | 3000 | `API_PROXY_TARGET`                      |

With the worker present, portal OTP and all schedules work. Rough cost:
~1.2 GB RAM + ~0.5 vCPU + disk — a few dollars per month at the listed rates.

## 6. Webhooks and going live with Chapa

1. Set the API's `API_PUBLIC_URL` to the API app's public HTTPS URL.
2. Point Chapa's webhook at `https://<api-app-host>/api/v1/webhooks/chapa` —
   it must reach the API **directly** (it does here; never route it through a
   re-serializing proxy — HMAC is verified over raw bytes).
3. Configure per-org credentials in Settings → Payment gateway (test mode
   needs no key; live needs the secret key). Runbook §6 has the checklist.

## 7. Post-deploy checklist

- [ ] `https://<api-app-host>/api/v1/health` returns 200
- [ ] Web landing page loads; sign-in works with your admin user
- [ ] `GET /api/v1/health/ready` returns 200 (DB reachable)
- [ ] Cookies work over HTTPS (leave `COOKIE_SECURE` unset — the app decides
      from `x-forwarded-proto`)
- [ ] Chapa webhook fires (test-mode transaction → webhook log in the panel)
- [ ] Backups: Neon's built-in PITR covers the database; images are rebuildable

## 8. Unverified platform details

The pricing page does not document these — confirm in the panel or their
Discord before relying on them: free-tier sleep/idle behaviour and cold starts;
persistent volumes (assume **no** — treat the container disk as ephemeral);
custom-domain mapping for the automatic HTTPS; private networking between apps
(this guide assumes apps talk over their **public** HTTPS URLs, which works
regardless).
