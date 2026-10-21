# Production runbook (single Alpine host)

The five things between "works on my machine" and "real money from real
tenants": a Postgres that survives power cuts, real secrets, HTTPS on the
domain, someone (or something) watching for outages, and a clear picture of
what NBE rules actually touch this app. Plus the 5-minute switch when the
Chapa key arrives, and an honest answer on a Flutter port.

Everything here is written for the actual setup: one Alpine Linux box,
Postgres already installed, the apps run with pnpm, CI already green.
For container deploys (JustRunMy.App free tier and other small PaaS hosts),
see `DEPLOY_JUSTRUNMY.md` — the Dockerfile targets and env tables live there.

---

## 1. Postgres durability — what fsync actually is

When Postgres accepts a write, it does not immediately trust the disk. It
asks the operating system to *fsync*: force the bytes physically onto the
storage device, and only then confirm the transaction to the client. That
confirmation is the whole contract — "if I said it's saved, it is saved".

The dev compose relaxes this on purpose, for throwaway demo data on small
machines:

```yaml
# docker-compose.yml (development only)
- -c fsync=off                 # don't force writes to physical disk
- -c synchronous_commit=off    # don't even wait for WAL to reach the OS cache
- -c full_page_writes=off      # don't guard against torn pages on crash
```

With those flags a power cut at the wrong moment can lose transactions the
app already reported as saved, or in bad cases corrupt the data directory.
Fine for a demo you can re-seed in a minute; never for real invoices.

**What to do on your machine.** If you installed Postgres with
`apk add postgresql` (not via docker-compose), the package defaults are
already safe — verify, don't assume:

```sh
psql "$DATABASE_URL" -c "SHOW fsync; SHOW synchronous_commit; SHOW full_page_writes;"
```

All three should say `on`. If you instead promote the compose service to
production, remove the three relaxed lines (i.e. just run Postgres with its
defaults) — nothing else changes.

**Durability is not backup.** fsync protects against crashes. It does not
protect against `rm -rf`, a failed migration, a dropped table, or a dead
disk. Minimum viable backup for a single host:

```sh
# /etc/periodic/daily/pg-backup  (busybox crond on Alpine: crontab -e)
pg_dump --format=custom --file "/var/backups/pms-$(date +%F).dump" "$DATABASE_URL"
# then push off the machine — a backup on the same disk is not a backup:
rclone copy /var/backups/pms-*.dump remote:pms-backups   # any object storage
```

Keep 30 days, and once a month actually restore a dump into a scratch
database and run the app against it. An untested backup is a hope, not a
backup. WAL archiving (pgBackRest / wal-g) is the next tier — only worth it
once an hour of lost data would actually hurt.

**One more file to back up:** `FIELD_ENCRYPTION_KEY`. It encrypts tenant ID
numbers at rest. The database without the key is unreadable in those
columns, and a *changed* key makes existing rows undecryptable. Store it in
the password manager next to the backups.

---

## 2. Secrets — exactly how they land in this app

The app already does the hard part: `apps/api/src/config.ts` validates every
variable at startup with zod and fails fast with a readable message, and
secrets are never logged. "Doing secrets" therefore reduces to: generate
strong values, inject them as environment variables, never commit them.

Generate them once, on the host:

```sh
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET   (must be a DIFFERENT value)
openssl rand -base64 32   # FIELD_ENCRYPTION_KEY
```

Where they live: the root `.env` (git-ignored; `.env.example` documents every
variable) or an OpenRC/daemon environment file. `.env` is read from
`apps/api/.env` or the repo root — nothing else. If you later containerize,
the same variables move into the compose file or `docker secrets` unchanged.

| Variable                | Notes                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| `JWT_ACCESS_SECRET`     | min 32 chars; signs 15-minute access tokens                        |
| `JWT_REFRESH_SECRET`    | min 32 chars; **different value** from the access secret           |
| `FIELD_ENCRYPTION_KEY`  | min 32 chars; encrypts tenant ID numbers; back it up, never rotate casually |
| Postgres password       | `pms`/`pms` is demo-only; real password + non-superuser role        |
| `CHAPA_SECRET_KEY`      | only when going live (section 6)                                   |

Rotation is a restart: set the new value, restart the API. Rotating
`JWT_REFRESH_SECRET` logs everyone out (they just log in again) — acceptable.
Rotating `FIELD_ENCRYPTION_KEY` does NOT decrypt old data; if you ever must,
that's a re-encryption migration, not an env change.

**The origin allowlist** is the other half of "secrets": which browser
origins may call the API, and which hosts the app accepts state-changing
requests from. For a real domain, the block looks like:

```sh
CORS_ORIGINS=https://pms.example.com
APP_ORIGIN=https://pms.example.com        # only needed if a proxy forwards an unexpected Host
PORTAL_RETURN_ORIGIN=https://pms.example.com  # where Chapa sends the payer back
API_PUBLIC_URL=https://pms.example.com    # builds the webhook URL — must be publicly reachable
```

---

## 3. HTTPS + your domain

The browser only ever talks to the Next.js app (its server proxies
`/api/v1` to the API), so **one public port is enough**. The one exception
is Chapa's webhook, which must reach the Express API with the exact raw
bytes it signed — the Next proxy re-serializes JSON bodies, and a re-serialized
body breaks the HMAC check. So route webhook paths straight to the API and
skip the extra hop:

Caddy is the least-effort reverse proxy on Alpine — automatic Let's Encrypt,
no certbot timers:

```sh
apk add caddy
rc-update add caddy default && rc-service caddy start
```

`/etc/caddy/Caddyfile`:

```caddyfile
pms.example.com {
    # Chapa webhooks: raw bytes, straight to the API (no proxy re-serialization)
    handle /api/v1/webhooks/* {
        reverse_proxy 127.0.0.1:4000
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

DNS: one `A` record (or `AAAA`) at your registrar pointing at the host.
Caddy obtains and renews the certificate on first request.

Then the env follows TLS:

- `COOKIE_SECURE=true` — session cookies only travel over https
- the origin block from section 2, all values `https://…`

Running the apps at boot (OpenRC, one service file each, same shape):

```sh
# /etc/init.d/pms-api  (adapt: web service runs `pnpm --filter web start`)
command="/usr/bin/node"
command_args="apps/api/dist/main.js"   # or your built entry
directory="/srv/pms"
command_background="yes"
pidfile="/run/pms-api.pid"
output_log="/var/log/pms-api.log"
error_log="/var/log/pms-api.err"
depend() { need net postgres; }
```

`rc-update add pms-api default` — and the same pattern for the web app and
the worker (`apps/api/src/worker.ts`, needed for the charge-generation and
overdue-sweep crons). Containerizing instead is optional polish, not a
requirement; CI already runs the apps.

---

## 4. Watching it after launch

**Uptime** — an external monitor is the honest one: if the box dies, a
self-hosted monitor on the same box dies with it. UptimeRobot (free) or
healthchecks.io pinging:

- `https://pms.example.com/api/v1/health` — liveness
- `https://pms.example.com/api/v1/health/ready` — readiness (checks the DB)

Alert if `/health/ready` fails twice in a row: that is almost always Postgres.

**Errors** — Sentry's free tier (or self-hosted GlitchTip, same protocol)
catches what users never report. Wrap the API first; the web app second.
This is the one place an extra dependency buys more than it costs.

**Logs** — the API logs structured pino events. In production set
`LOG_LEVEL=info`, send the OpenRC output logs to the same off-site rclone
bucket as the backups, and put a disk-space alarm on the monitor — a full
disk is the #1 way a small host dies (Postgres logs, uploads in
`STORAGE_LOCAL_DIR`, backups themselves).

---

## 5. NBE compliance — what actually applies to this app

Short version: **less than it looks.** The National Bank of Ethiopia
licenses and supervises payment instrument issuers, payment service
providers, and banks. Chapa is the regulated party in this architecture —
card, telebirr, and M-Pesa money moves along Chapa's licensed rails, and
your app records invoices and their settlement. You are property-management
software plus the landlord's back office; you are not issuing payment
instruments, not holding customer float, and you never touch raw card data
(payers type it into Chapa's hosted checkout, and this app only ever sees
`tx_ref` and verified status).

What applies regardless — ordinary business obligations, not NBE:

- **Records**: keep invoices, receipts, and payment ledger entries for
  several years (tax/business law). The payments table + audit log already
  capture this; the obligation is retention, not new code.
- **Data protection**: Ethiopia's Personal Data Protection Proclamation
  (1321/2024) — collect for a stated purpose, secure it, honor access/
  deletion requests. The app already encrypts tenant ID numbers at rest and
  keeps ID documents in private, access-controlled storage; that is the
  right posture.
- **Tax**: a TIN for the business, VAT/income treatment of rent — an
  accountant question, not a software one.

When NBE questions would genuinely start: if the system ever holds tenant
money itself (wallet balances tenants top up and the landlord later spends),
issues store credit redeemable as money, or collects on behalf of many
landlords at scale in a way that looks like payment aggregation. If a
feature like that is ever on the roadmap, talk to a lawyer *before* writing
code — but nothing currently built is that.

This section is orientation, not legal advice: once real money flows, spend
one hour with an Ethiopian accountant or lawyer walking through this exact
list.

---

## 6. When the Chapa key arrives (the 5-minute switch)

The adapter is already mode-aware: **a saved secret key means live mode, no
key means the built-in sandbox.** Two supported paths:

- **Per-organization (recommended):** Admin → organization gateway
  settings → provider `chapa` → paste the secret key. It is AES-256-GCM
  encrypted before it touches the database, shown back only as `••••last4`,
  and audited. The UI enforces mode-aware validation (test mode needs no
  credentials, live mode demands the secret key).
- **Platform default:** set `PAYMENT_PROVIDER=chapa` and `CHAPA_SECRET_KEY`
  in `.env`; organizations without their own settings then use it.

To receive payment events:

1. `API_PUBLIC_URL=https://pms.example.com` in the API env (builds
   `{API_PUBLIC_URL}/api/v1/webhooks/chapa`).
2. In the Chapa dashboard, register the webhook URL and paste the same
   secret into `CHAPA_WEBHOOK_SECRET` / the gateway settings. Events are
   HMAC-verified against the raw bytes; invalid signatures are discarded
   with a 400.
3. Webhooks are only a trigger: every event is re-verified against Chapa's
   API before any money is recorded, through the same serialized completion
   path as the tenant's return page. A missed webhook is self-healing — the
   return page still settles the payment.
4. Do one small live payment end to end (invoice → checkout → ledger entry
   → receipt), then keep a test-mode organization for demos.

Live-mode refunds run from the Chapa dashboard for now — `refund` /
`reconcile` endpoints were deliberately not implemented until Chapa's docs
confirm the exact contracts; the adapter refuses with a clear message
instead of guessing URLs.

---

## 7. A Flutter port, honestly

What survives untouched: **the entire backend.** REST API, auth and
sessions, payments, storage, jobs, audit — a Flutter client consumes the
same `/api/v1` the PWA does. That is the expensive half of the product, and
none of it is thrown away.

What does not survive: every screen. Next.js/React components → Flutter
widgets is a full rewrite — including the Gregorian/Ethiopian double
calendar, the en/am/om/ti translations, the documents rail, forms, and the
checkout pages. For the combined admin + tenant surface, think weeks-to-
months, not days.

The cheap middle path most teams actually take:

| Option            | Cost         | Store presence | Native feel                    |
| ----------------- | ------------ | -------------- | ------------------------------ |
| PWA (today)       | done         | installable on Android, iOS support improving | good |
| **Capacitor wrapper** | days     | Play Store + App Store | wrapped web view; push via plugins |
| Flutter rewrite   | weeks–months | full           | true native, offline-first possible |

Recommendation: stay PWA; if store presence becomes a business need (e.g.
tenants expect an app icon), wrap the existing PWA with Capacitor first.
Choose a real Flutter rewrite only when a concrete native requirement justifies
it — offline-first sync, biometric login, background notifications. If only
*tenants* ever get an app (the common pattern — owners/admins keep the full
web console), the Flutter surface is the portal alone, which is a much
smaller, realistic project.

Keeping the door open meanwhile needs no extra work today: business logic
already lives in the API (not the web app), the contract is versioned
(`/api/v1`), and responses are typed end to end. Those are exactly the
properties a future Flutter client depends on.
