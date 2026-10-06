# Property Management System — Ethiopia

Commercial property management for property owners and landlords in Ethiopia.
Built for **ETB**, the **Ethiopian calendar alongside the Gregorian one**, and
Ethiopian addresses, with English first and Amharic, Afaan Oromo and Tigrigna
catalogs shipped as (clearly marked) machine drafts.

SaaS from the first migration: one installation serves many organizations, each
with its own properties, staff, roles, settings, language and calendar.

|        |                                                                |
| ------ | -------------------------------------------------------------- |
| Web    | Next.js 15 (App Router), React 19, Tailwind v4, Apache ECharts |
| API    | Node 20, Express 5, TypeScript, Zod, Prisma                    |
| Data   | PostgreSQL 17 (only), migrations committed, append-only ledger |
| Jobs   | pg-boss worker process (`apps/api/src/worker.ts`)              |
| Shared | `@pms/calendar`, `@pms/shared`, `@pms/i18n`                    |
| Tests  | Vitest — 8 API integration files plus the three libraries      |

---

## Quick start (clean clone)

```bash
# 1. Requirements: Node 20+, pnpm 9 (corepack enable), Docker (or any PostgreSQL 15+)
corepack enable && corepack prepare pnpm@9.15.4 --activate

# 2. Clone and install
git clone https://github.com/michaeltsige/property-management-system-et.git
cd property-management-system-et
pnpm install

# 3. One env file, at the repository root
cp .env.example .env            # never commit .env

# 4. Everything else: Postgres (Docker), migrations, fake demo data, API, worker, web
pnpm dev:all                    # web http://localhost:3000 · api :4000
```

`pnpm dev:all` is idempotent — run it every time you come back. It starts PostgreSQL
in Docker, waits for it, applies migrations, seeds demo data **only when it is
missing**, then runs the API, the job worker and the web app with capped heaps so the
whole stack fits on a small VM.

Running in **Google Cloud Shell**? See **[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)** for
the exact steps, the Web Preview port to open, and how to recover after the VM resets
(short version: `pnpm dev:all`, port 3000).

The seed creates a demo organization with two properties, seven units, five
tenants, three leases, charges for the current period and two payments:

```
email:    owner@demo.test
password: DemoPass123
```

**Those credentials are demo-only.** Delete or change them before any deployment.

## Everyday commands

```bash
pnpm dev:all        # Postgres + migrations + seed + api + worker + web (one command)
pnpm dev            # just the two apps in watch mode (builds @pms/* first)
pnpm build          # build every workspace (packages first)
pnpm lint           # ESLint, all workspaces
pnpm typecheck      # tsc --noEmit, all workspaces
pnpm test           # Vitest, all workspaces

pnpm db:generate    # regenerate the Prisma client
pnpm db:migrate     # create/apply a migration (development)
pnpm db:deploy      # apply migrations (CI / production)
pnpm db:seed        # fake demo data (idempotent: skips when the demo org exists)
pnpm db:seed:force  # recreate the demo organization from scratch
pnpm worker         # background jobs (pg-boss); never run inside the API process
pnpm worker -- --once=charges.generate   # one job run, for cron
pnpm audit          # dependency audit (high and above)
```

Run a single workspace when you are iterating:

```bash
pnpm --filter @pms/calendar test
pnpm --filter @pms/api test
pnpm --filter @pms/web dev
```

### Tests need a `_test` database

The API suite is integration-first: it truncates the database between tests and it
**refuses to run** against a database whose name does not end in `_test`. Set
`TEST_DATABASE_URL` in `.env` (the docker-compose file creates `pms_test` for you).

## What is in the box

- **Portfolio** — properties, units, tenants with Ethiopian addresses (region,
  city/zone, sub-city, woreda, kebele, house number, landmark) and configurable
  local ID types; ID numbers are encrypted at rest and redacted in audit logs.
- **Leases** — billing calendar per lease, due day, grace period, deposit,
  escalation, co-tenants, termination (which frees the unit and can refund the
  deposit).
- **Money** — monthly charges generated per period (idempotent, pro-rated for a
  mid-period start), waivers, manual payments (cash, bank transfer, cheque),
  oldest-first allocation, overpayment as credit, reversing entries, per-lease
  statements, receipts.
- **Operations** — vendors, work orders with an enforced status flow, documents
  (checksummed, MIME- and size-restricted, downloaded through the API),
  notifications rendered in the recipient's language.
- **Reporting** — dashboard summary, rent roll, aged arrears, occupancy,
  collections, each with CSV export, in either calendar.
- **Administration** — organization settings, members and roles, ID types, and a
  Translation Manager with review status, per-key history and CSV import/export.
- **Ethiopian calendar everywhere** — 13-month (12 × 30 + Pagume) date picker,
  Geʽez numerals, Ethiopian or Gregorian display per organization with a per-user
  override. Conversion is tested against ICU as an oracle.

## How sign-in works

The browser talks to the web app only. `POST /api/session/login` forwards the
credentials to the API, keeps the access and refresh tokens in **HttpOnly** cookies
the JavaScript cannot read, and answers with `{ user, organization }` and nothing
else. Every other request goes to `/api/v1/...` on the same origin, and the Next.js
server adds `Authorization: Bearer …` from that cookie before calling the API — so
the browser never sends or stores a token, and an `Origin`-rewriting proxy in front
of the app cannot break authentication. Expired access tokens are refreshed on the
server and the request is replayed. CSRF is refused by requiring
`X-Requested-With: XMLHttpRequest` plus an `Origin` check (ADR-0026).

The Express API is unchanged for everything else: it still authenticates plain
`Bearer` tokens, so `curl`, scripts and the future mobile app work as before. The
API port is never published, and the web app does not need `CORS_ORIGINS`.

## Architecture and decisions

- `docs/LOCAL_DEV.md` — local and Google Cloud Shell setup, ports, VM-reset recovery,
  and the Web Preview sign-in checklist.
- `docs/ROADMAP.md` — the phase plan and what is done, with open questions.
- `docs/ARCHITECTURE.md` — how the pieces fit and why, plus the domain ERD and MVP scope.
- `docs/FEATURE_MATRIX.md` — feature-by-feature comparison with the reference projects.
- `docs/SCREENS.md` — navigation tree and screen inventory.
- `docs/DECISIONS.md` — ADRs, plus the list of rules that **need a local accountant
  or lawyer** to verify (VAT, rental income tax, stamp duty, lease law, ID-document
  retention) and the assumptions made so far.
- `docs/API.md` — the REST reference and the background jobs.
- `docs/PHASE_3_REPORT.md` — what the web UI phase changed, what the browser found,
  and what is still unverified. Evidence in `docs/screenshots/phase-3/`.
- `docs/REFERENCES.md` — every reference project, its license, and what was (and was
  not) taken from it.
- `docs/ci/ci.yml` — the CI workflow; copy it to `.github/workflows/` if the token
  used to push could not create workflow files.

## Rules of the road

- Business logic lives in `apps/api`; the web app and the future mobile app are
  clients of the same REST API.
- Money is integer minor units (santim) plus a currency code. Never a float.
- Timestamps are UTC in the database; calendars are a boundary concern handled by
  `@pms/calendar`.
- Financial and lease records are append-only; corrections are reversing entries.
- Every query is organization-scoped, and a cross-organization read or write is a
  404, never a 403.
- Secrets only from the environment; `.env` is never committed and required variables
  are validated at startup.
- Conventional Commits, a branch and a pull request per change, tests with every
  feature, and **never push to `main`**.

## License

MIT — see `LICENSE`. Third-party attributions: `THIRD_PARTY_NOTICES.md`.
