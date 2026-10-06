# Decisions

Short architecture decision records. Each one states the decision, why, and what it
costs. Anything that changes the fixed stack has to be added here and approved
before it is implemented.

Status legend: **Accepted** (in force), **Accepted, needs human verification**
(implemented, but a local professional must confirm the rules), **Deferred**.

---

## ADR-0001 — Monorepo with pnpm workspaces and Turborepo

**Accepted.**

`apps/*` and `packages/*` in one repository, one lockfile, Turborepo for
`build`/`lint`/`typecheck`/`test` ordering. The mobile app will live in
`apps/mobile` later without a second repository or a publish step for the shared
packages.

_Cost:_ Turborepo adds a little configuration; in exchange, `pnpm test` at the root
runs exactly what CI runs.

## ADR-0002 — Express 5 API behind `/api/v1`, Next.js as a pure client

**Accepted.**

All business logic lives in `apps/api`. The web app calls REST endpoints over HTTP
with an access token and never reaches the database. No Next.js server action is the
only path to any rule, because a future mobile app must be able to do everything the
web app can.

_Cost:_ two processes to run locally, and money formatting logic duplicated in
`packages/shared` for display only.

## ADR-0003 — Prisma + PostgreSQL only, migrations committed

**Accepted.**

One database technology, migrations in `prisma/migrations`, `pnpm db:migrate` for
development and `pnpm db:deploy` for deployments. `docker-compose.yml` provides a
local PostgreSQL 17 with a `pms_test` database for the test suite. No SQLite
fallback: the ledger relies on real transactions, `Serializable` isolation and
unique constraints.

_Cost:_ contributors need a PostgreSQL instance; Docker is the easy path.

## ADR-0004 — Multi-organization from the first migration

**Accepted.**

Every tenant-owned table carries `organizationId`, enforced in the service layer and
proven by `apps/api/src/test/isolation.test.ts`, which reads _and writes_ across two
organizations. A record belonging to another organization returns **404, never
403**, so the API cannot be used to probe for existence.

_Cost:_ every query needs the organization id threaded through. There is no
"simple mode" for a single landlord.

## ADR-0005 — Money is integer minor units plus a currency code

**Accepted.**

Amounts are `{ amountMinor: number, currency: string }` in TypeScript and `BigInt`
columns in PostgreSQL (1 ETB = 100 santim). No float ever touches an amount:
arithmetic, percentages, pro-rating and allocation all happen in integer space
(`packages/shared/src/money.ts`), half-up rounding, with `allocateMoney` using the
largest-remainder method so a split always re-sums to the original. The API
serialises `BigInt` as a **decimal string** (`"1500000"`), never a JSON number, so no
client silently loses precision.

_Cost:_ every client must format through the shared helpers; raw JSON is not
human-readable.

## ADR-0006 — UTC instants in the database, calendars at the boundary

**Accepted.**

`DateTime`/`Date` columns hold UTC. The `packages/calendar` library is the only place
that converts, and it is tested against ICU (`Intl` with the `ethiopic` calendar) as
an independent oracle, plus explicit Pagume, leap-year and year-boundary cases.

Each **lease** carries a `billingCalendar` (`ethiopian` | `gregorian`), and its
charges and due dates are generated in that calendar, so a lease billed on the
Ethiopian calendar gets 13 periods per year (12 × 30 days + Pagume, 5 or 6 days).
The calendar preference is an organization default with a per-user override, which
affects display only.

_Cost:_ two period-key namespaces. A charge's `periodKey` (`"2019-01"`) is only
meaningful together with its calendar, which is why every response that carries a
period also carries `calendar`.

## ADR-0007 — Append-only ledger, corrections by reversing entries

**Accepted.**

`LedgerEntry` rows are never updated or deleted. Charges post positive entries,
payments negative ones, reversals the exact negation, linked through
`reversesEntryId`. A lease's balance _is_ `sum(amountMinor)`. Reversing twice is a 409.

_Cost:_ a typo leaves two rows instead of one corrected row — deliberate, because
that is what auditors expect.

## ADR-0008 — Idempotent charge generation enforced by the database

**Accepted.**

Monthly generation is safe to re-run: `Charge` has
`@@unique([leaseId, periodKey, type])`, so a duplicate insert fails and is _counted_
as `skippedExisting` rather than treated as an error. Background work runs in
`apps/api/src/worker.ts` (pg-boss queues `charges.generate`, `charges.overdue-sweep`,
`notifications.send`) and **never** in the web request process. A mid-period lease
start is charged pro-rata for that first period only.

_Cost:_ no "regenerate silently" button — a wrong amount is fixed with a waiver or
a reversing entry, which keeps the history honest.

## ADR-0009 — Payment provider interface; mock adapter only for now

**Accepted, needs human verification.**

`initiate / verify / handleWebhook / refund / reconcile`, with adapters for `mock`,
`telebirr` and `chapa`. Manual payment recording (cash, bank transfer, cheque) is
first-class and goes through the same transaction path as a provider payment.

The Telebirr and Chapa adapters throw `PROVIDER_NOT_CONFIGURED` and name exactly
which credentials and which piece of documentation is missing. **No request shape
is guessed.** The webhook HTTP route is not exposed until signatures can be verified
against official docs (see `docs/API.md`).

_Cost:_ online payment collection is not live in Phase 1; the interface is.

## ADR-0010 — i18n: stable keys, DB override → shipped catalog → English

**Accepted.**

Keys are identifiers (`lease.status.active`), never English sentences. Lookup order:
organization override → global override → shipped catalog → English fallback → the
key itself. Every resolved string reports its source and review status
(`machine_draft`, `unreviewed`, `reviewed`), so unreviewed machine drafts are visible
as such in the Translation Manager. ICU plurals are linted in CI, which catches a
translation that drops a `{amount}` placeholder before a tenant receives the SMS.

Amharic, Afaan Oromo and Tigrigna ship as machine drafts (193 keys each) and are
**not** trusted until reviewed; the UI labels them "machine draft" (see
"Needs human verification" below).

_Cost:_ translators work in the admin UI or CSV rather than in code review — which is
also the benefit.

## ADR-0011 — Auth: Argon2id, short access tokens, rotating refresh tokens

**Accepted.**

Argon2id password hashing (`@node-rs/argon2`), HS256 JWTs (`jose`) valid for 15
minutes, refresh tokens stored **hashed** in `AuthSession` and rotated on every use;
reusing a rotated token revokes the whole family. Login is locked for 15 minutes
after 10 failures, and `/auth/*` is rate limited per IP. Roles (`owner_admin`,
`manager`, `accountant`, `maintenance`, `tenant`) map to one permission matrix in
`packages/shared/src/permissions.ts` that both the API and the UI use.

_Cost:_ a compromised access token is valid for up to 15 minutes; the alternative
(session lookups per request) trades that for database load.

## ADR-0012 — Noto Sans Ethiopic loaded from Google Fonts for now

**Accepted, deferred work.**

Ethiopic script needs a font that has it; `Noto Sans Ethiopic` (SIL OFL 1.1) is
referenced from Google Fonts in `apps/web/src/app/globals.css`. Self-hosting the
font (with the OFL text in `THIRD_PARTY_NOTICES.md`) is the Phase 2 task, required
before any offline or on-premise deployment.

## ADR-0013 — Storage interface with a local driver first

**Accepted.**

Uploads go through `StorageDriver` (`put`, `get`, `delete`, `exists`); the local disk
driver stores under `storage/<organizationId>/<yyyy>/<mm>/<uuid>` with a path
traversal guard, an allow-list of MIME types (PDF, JPEG, PNG, WEBP) and a 10 MB
limit, checksummed with SHA-256. An S3 driver is a later drop-in behind the same
interface; documents are soft-deleted and downloaded through the API so storage keys
never appear in URLs.

## ADR-0014 — Audit log for financial and lease records, with redaction

**Accepted.**

Every create/update/delete of a charge, payment, ledger entry, lease or membership
writes an `AuditLog` row with actor, action, entity, before and after. Encrypted
values (tenant ID numbers) are **redacted** in the snapshot: the audit trail is not a
side channel for the data it protects.

## ADR-0015 — Legally sensitive rules are data, not code

**Accepted, needs human verification.**

VAT, rental income tax, stamp duty, withholding and lease-termination rules live in
`TaxRule` rows and `UNVERIFIED_TAX_DEFAULTS` with `verified: false`. The system never
computes a tax return in Phase 1; it stores configurable rules and flags them in the
UI. Turning any of them on requires a local accountant or lawyer to confirm the rule
and rate (see the list below).

## ADR-0016 — Rate limiting is a factory so tests can be honest

**Accepted.**

`createRateLimiter({ windowMs, max })` builds every limiter; production settings come
from config, and `rate-limit.test.ts` builds one with a limit of 3 to prove the 429
contract rather than disabling the protection. The auth test configuration raises the
budget (env only, tests) so a suite that signs in dozens of times stays deterministic
without touching production values.

## ADR-0017 — Reference projects are ideas, not code

**Accepted.**

OpenProperty (MIT), open-condo (MIT) and MicroCommunity/MicroCommunityWeb
(Apache-2.0) were cloned **outside** this repository and read for domain ideas,
feature checklists and navigation. No file, asset, style or text was copied; the UI
was recreated in React/Tailwind. Pronto Housing (proprietary) contributed concepts
only. Details per project in `docs/REFERENCES.md`, attributions in
`THIRD_PARTY_NOTICES.md`.

---

## ADR-0018 — Dependency audit: fix what can be fixed, document what cannot

**Accepted.**

`pnpm audit --audit-level=high` runs locally and in CI. Two findings were fixed with
pnpm overrides rather than by waiting for upstream:

- `postcss` pinned in `next` at 8.4.31 → forced to `^8.5.23` (source-map path
  traversal and the `</style>` stringify advisory). `next build` and the CSS
  pipeline still pass.
- `deepmerge-ts` 7.x inside Prisma's config loader → forced to `^8.0.0` (recursive
  merge stack exhaustion). `prisma validate` and `prisma generate` verified after.

Three advisories remain and are **accepted with reasons**, re-checked at the start of
each phase:

| Package                                                                | Severity | Why it is accepted                                                                                                                                                                      |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `braces` (via `@next/eslint-plugin-next` → `fast-glob` → `micromatch`) | high     | ESLint tooling only, never in a deployed artifact. It parses _our own_ glob patterns, not user input, and no patched version exists yet.                                                |
| `vitest` / `@vitest/mocker`                                            | moderate | Test runner only, pinned at 3.x; the fix ships in vitest 4, which is a major upgrade to schedule deliberately rather than by surprise. Tests execute our own code, not untrusted input. |

There are **no critical or high advisories in any runtime dependency**: the API
server, the web bundle and the shared packages are unaffected.

## ADR-0019 — One command for local development, one env file, browsers never call the API

**Accepted.**

`pnpm dev:all` (Postgres via Docker → wait → `migrate deploy` → seed → API + worker +
web) is the supported way to run the stack, and it is written for small VMs such as
Google Cloud Shell: capped Node heaps (384 MB API/worker, 768 MB web), telemetry off,
a lightly tuned Postgres container (`shared_buffers=128MB`, `mem_limit: 512m`).

Three rules behind it:

- **The browser only ever talks to the web app.** `src/lib/api.ts` uses relative URLs
  and `next.config.ts` rewrites `/api/*` to the API server-side (`API_PROXY_TARGET`,
  default `127.0.0.1:4000`). One origin in every environment, one published port, no
  `localhost` in a browser request, no CORS juggling for previews. _(The rewrite was
  replaced by route handlers that also own the session cookie; see ADR-0026 — the
  claim held, the mechanism did not.)_
- **Every process binds `0.0.0.0`**, because a port-forwarding proxy (Cloud Shell Web
  Preview, any tunnel) reaches the VM from outside: `next dev --hostname 0.0.0.0` and
  `API_HOST` defaulting to `0.0.0.0`. Cloud Shell hostnames are listed in
  `allowedDevOrigins`, which only affects `next dev`.
- **One `.env` at the repository root.** A small wrapper (`scripts/with-env.mjs`) loads
  it for the repository's own scripts, and the API loads it as a fallback after
  `apps/api/.env`, so `pnpm dev:all`, `pnpm db:deploy`, Prisma and `tsx` read the same
  values. Real environment variables always win, so CI and production are unaffected.

The seed is idempotent: it stops when the demo organization exists (`pnpm db:seed:force`
recreates it), which keeps repeated `dev:all` runs fast and stops ids changing under a
running app. Docker volumes live outside `$HOME`, so a Cloud Shell VM reset simply
means the schema and demo data are rebuilt from migrations on the next run — documented
in `docs/LOCAL_DEV.md`.

_Cost:_ a Node bootstrap script (~250 lines) instead of a `concurrently` dependency, and
a documented PostgreSQL tuning that is deliberately not production-safe (`fsync=off`) —
it only ever applies to the throwaway dev container.

---

## ADR-0020 — MVP scope is fixed and everything else is named

**Accepted (Phase 0).**

The MVP is the month a landlord actually runs: portfolio and tenants, leases with a
billing calendar, idempotent charges, manual payments with allocation and reversals,
maintenance work orders, documents, notifications through an interface, four reports,
and the localization pipeline. Everything else is written down as v1 or later in
`docs/FEATURE_MATRIX.md` and `docs/ARCHITECTURE.md` rather than left implicit.

_Why:_ the references show the failure mode — OpenProperty has no reports, no
documents and no auth; MicroCommunity has everything and is unusable as a starting
point. A named "not yet" is what keeps the MVP finishable.

## ADR-0021 — Reference projects inform the model, never the code

**Accepted (Phase 0).**

Licences were verified by reading each LICENSE file: OpenProperty (both) MIT,
open-condo MIT, MicroCommunity and MicroCommunityWeb Apache-2.0, Pronto proprietary.
**No file, asset, style or text was copied from any of them.** What was taken is
recorded per project in `docs/REFERENCES.md`, and Apache-2.0's requirements (licence
and NOTICE retention, change notices) apply only if code is ever copied — in which
case the file, source path and change notice are added to `THIRD_PARTY_NOTICES.md`.

_Why:_ the two OpenProperty forks are the closest domain match and the most tempting
to lift from, but they contain **no authentication at all** (verified by grep) and use
floats for money. Copying them would import those decisions.

## ADR-0022 — Ethiopian requirements are the product, so they are tested like it

**Accepted (Phase 0).**

The feature matrix shows no reference supports an Ethiopian billing calendar, ETB
integer money, Geʽez formatting or configurable unverified tax rules. Since that is
the entire reason this product exists for Ethiopian landlords, those behaviours get
the strictest treatment: conversion and period maths verified against ICU as an
independent oracle, Pagume and leap-year cases enumerated, money as integer santim
with property tests over allocation, and tax values that carry `verified: false`
until a local professional confirms them.

_Why:_ the parts nobody else has built are the parts with no reference implementation
to compare against, so tests are the only specification we have.

---

## NEEDS HUMAN VERIFICATION (local accountant / lawyer)

None of the following is a legal opinion, and none of it is enabled by default. Each
item is a placeholder that must be confirmed before it is used with real money or
real contracts. Every one carries `verified: false` in the data model, and the UI
shows them as unverified.

1. **VAT on rent and on management fees.** Rate, registration threshold, which
   supplies are exempt (residential rent is commonly treated differently from
   commercial), invoice requirements, and whether the landlord or the managing agent
   is the taxable person. Shipped placeholder: 15%.
2. **Rental income tax.** Residential vs commercial schedules, the deductible-expense
   rules, whether tax is withheld at source by the tenant/agent, monthly vs annual
   filing, and the TIN/declaration obligations of a landlord who is not an individual.
3. **Withholding tax** on rent paid by businesses or by government tenants: rate,
   who withholds, and how the withholding interacts with the rental income tax above.
4. **Stamp duty** on lease agreements (rate, who pays, and whether registration is
   required for the lease to be enforceable).
5. **Lease law.** Notice periods for termination and eviction, security-deposit rules
   (maximum, interest, return window), rent-increase frequency and caps, and
   whether the "grace period" concept here matches the statutory one.
6. **Rules for the Ethiopian calendar in contracts.** Whether a lease written in the
   Ethiopian calendar must state the Pagume-6 years explicitly, and how a
   month-based due date should be clamped for Pagume (5 or 6 days) in a legally
   binding way. Our behaviour: the due day is clamped to the last day of the period.
7. **Identity documents.** Which local ID types may lawfully be collected, copied and
   stored by a landlord/agent (Kebele ID, national ID, passport, driving licence,
   TIN certificate), for how long, and what consent/notice is required. The system
   encrypts the number, keeps only the last four digits visible, redacts audit
   snapshots, and enforces a retention setting that is currently `0 = keep` — a
   lawyer or the Data Protection authority should set it.
8. **Ethiopian tax calendar.** Fiscal year (commonly Hamle 1 – Sene 30) and filing
   deadlines are configurable, but the defaults must be confirmed.
9. **Language review.** Amharic, Afaan Oromo and Tigrigna catalogs are machine drafts
   (193 keys each). The legal and financial vocabulary — "arrears", "deposit",
   "notice period", "stamp duty" — needs a native reviewer before launch. This is a
   translation-quality risk, not a legal one, and it is tracked in the Translation
   Manager as `machine_draft`.
10. **Telebirr / Chapa integration.** Request envelopes, signature schemes and webhook
    payloads must come from official sandbox documentation and credentials. Until
    then, `PROVIDER_NOT_CONFIGURED` is the correct behaviour.

## ADR-0023 — A phone is a first-class way to use this product

**Context.** The shell rendered a sidebar at `lg` and up and _nothing_ below it. A
landlord on a phone could sign in and see the dashboard, and could not reach any
other screen. Ethiopia is a mobile-first market; a product that only works on a
laptop is not the product we were asked for. Phase 3 also asked for "PWA basics".

**Decision.** Below `lg`, the navigation moves into a Radix-dialog drawer with the
same links, the same active-page marking and the language/calendar controls, and
every create screen can be opened from the dashboard with `?new=1`. The app ships a
manifest, an icon set and a service worker with three deliberate rules: static build
assets and icons are cached; page navigations are network-first with an offline
fallback; **`/api/*` is never cached**. The worker never replays a failed write, so
"record a payment" is always a live request.

**Consequences.** A phone user can do the whole job — create a property, a unit, a
lease, record rent — which is what the Phase 3 acceptance criterion asks. Offline is
honest rather than clever: the previously loaded page or a plain "you are offline"
screen, never stale money. A background-sync queue is deliberately not built; when
it is, it belongs in a later phase with server-side idempotency keys to match.

**Rejected.** Cache-first page shells (serve stale application code, hard to
invalidate); caching GETs of financial data (a screen showing yesterday's arrears as
if it were today's); making the sidebar a horizontal scroller (13 months × 12 rows of
navigation does not scroll well, and it hides the labels that make it usable).

## ADR-0024 — Accessibility is tested, not asserted

**Context.** Phase 3 asks for "states, filters, pagination, forms" and an
accessibility pass. Manual review of twelve screens does not scale, and this project
is worked on by an agent that must be able to prove its claims.

**Decision.** Accessibility is enforced by machine-checkable rules with a human
reading of the results:

1. Every screen carries an explicit focus ring (a global `:focus-visible` fallback),
   a document title (`useDocumentTitle`), and a skip link to `#main`.
2. Every icon-only control has an `aria-label`; every filter `<select>` has a name;
   every form control either has a visible `<label>` or an `aria-label`.
3. Charts — `canvas`, and therefore opaque to assistive technology — are exposed as
   `role="img"` with a descriptive label **and** the same numbers as a visually
   hidden table. This is also the graceful fallback when the canvas cannot draw.
4. Text and UI colours meet WCAG AA. The gold accent was darkened from `#a97710`
   (measured 3.5:1) to `#8a5f0c` (5.0:1 on the gold tint, 5.6:1 on white) and the
   white-on-gold button moved to `#8a5f0c` (5.6:1). Every change here came from a
   measured axe-core violation, not from taste.
5. `apps/web` has a jsdom component-test layer (Testing Library + Vitest) that locks
   the behaviours a refactor would quietly break: skip link, `aria-current`, the
   drawer's focus trap and labelled controls, the chart text tables, and the
   `?new=1` deep link.

**Consequences.** `pnpm --filter @pms/web test` fails if someone removes the chart
labels or the drawer's close control. The full-page audit (axe-core over all 12
screens in a real browser, both phone and laptop widths) is run at the end of the
phase and its report is committed — it is evidence for a reviewer, not a CI gate,
because it needs a browser and a seeded database.

**Honest limits.** Automated rules catch roughly a third of real accessibility
problems. Colour contrast, focus order, labels and landmarks are covered; "is this
sentence understandable, is this flow logical, does the screen reader announcement
make sense" was not tested with a person who uses a screen reader. That review is
listed as an open issue in the Phase 3 report.

## ADR-0025 — The browser is the acceptance test

**Context.** Phase 3's acceptance criterion is behavioural: _a non-technical user
completes lease → payment on a laptop and at phone width_. Unit tests and curl
against an API cannot demonstrate that, and the first real browser run proved the
point by finding five defects that every existing test had passed over:

1. `GET /organizations/members` returns a **flat** row (`{id, userId, email,
fullName, role, status}`) while the web client's `Member` type declared a nested
   `user` object — the Settings screen crashed on render for every user.
2. `POST /auth/login` returned `memberships[]` but no top-level `role`, so the shell
   rendered the literal `role.undefined` in the header and drawer of every page.
3. Next's dev server blocks `/_next/*` for an origin it does not recognise. Reaching
   the app as `http://127.0.0.1:3000` (rather than `localhost`) served HTML whose
   JavaScript was refused: the login form fell back to a native submit and reloaded.
4. `MoneyInput` rendered its label without `htmlFor`/`id`, so the amount fields had
   no accessible name and the label was not a click target.
5. The gold accent (`#a97710` text, white on `#d29a17`) failed WCAG AA contrast.

**Decision.** Each phase's browser-driven acceptance test is part of the phase, and
its artefacts are committed: screenshots at both widths plus a machine-readable
report (`docs/screenshots/phase-3/verification-report.json`) containing the
walkthrough steps, the axe-core result per screen, and the PWA checks. Two contract
tests were added where the mismatch was invisible to TypeScript (`api` test asserting
the flat member shape and the login session shape).

**Consequences.** The walkthrough is reproducible by anyone with a seeded database
(the script is kept out of the repo because it needs Playwright; the report and the
screenshots are in it). Regenerating the evidence after a UI change is a deliberate
act, and the report states plainly what it did not check.

## ADR-0026 — The browser gets a cookie; the API token never leaves the server

**Accepted. Supersedes the "no CORS juggling" claim in ADR-0019** — the _goal_ of that
ADR still holds (one origin, one published port), but the mechanism it described did
not survive contact with a real proxy.

**Context.** A bug report from Google Cloud Shell Web Preview: sign-in succeeded, and
then every other request failed in the browser with `TypeError: Failed to fetch`,
never reaching the API (its logs showed no data requests at all). The front end sent
`Authorization: Bearer …` on each call, keeping the tokens in `localStorage`, and
`next.config.ts` forwarded `/api/*` to the API with a rewrite.

The rewrite itself was not the problem: reproduced locally, the rewrite forwards
`Authorization` and `GET /api/v1/auth/me` returns 200 both directly and through port 3000. What could not be reproduced here is Cloud Shell's edge. Authorization stripping
by Google's front ends is a documented class of failure elsewhere (the GCS XML API
warns about proxies that strip it; IAP strips it; GCP load balancers strip
`Proxy-Authorization`), and a proxy in the path that mangles a request is a far more
likely explanation than the API, which never saw the request. The honest conclusion
was that the header was the fragile part of the design, whether or not it was the
specific cause, and that a design which does not depend on a header surviving a
proxy is better regardless.

**Decision.** The browser never holds, sends or receives a token.

- `apps/web/src/app/api/session/[...action]/route.ts` — `login`, `register`, `refresh`,
  `logout`, `me`. It calls the API and sets `pms_at` / `pms_rt` as **HttpOnly**
  cookies (`SameSite=Lax`, `Path=/`, `Secure` decided from `x-forwarded-proto`, with
  `COOKIE_SECURE` as an override because Next sees plain http behind Cloud Shell's
  TLS-terminating edge). The JSON it returns is `{ user, organization }` — the
  response shape is asserted token-free in tests.
- `apps/web/src/app/api/v1/[...path]/route.ts` — everything else. Header **allowlists**
  in both directions: browser `Authorization`, `Cookie`, `Origin`, `Referer`, `Host`
  and `x-forwarded-for` are dropped and never reach the API, and only
  `content-type`/`accept`/`accept-language`/`if-none-match`/`if-modified-since`/`range`/
  `x-request-id` go out. The bearer header is added server-side from the cookie. On
  `401` the server refreshes once and replays the request (body buffered).
- The three token-minting API paths (`/auth/login`, `/auth/register`, `/auth/refresh`)
  return `404 NOT_PROXIED` through the browser proxy, so a token cannot be coaxed out
  of the API from the front end even by hand-crafting a request.
- `apps/web/src/lib/api.ts` keeps only the identity in storage; a stored session from
  an older build is rebuilt field-by-field, so legacy tokens are dropped on first load.
- **CSRF** — a state-changing request must carry `X-Requested-With: XMLHttpRequest`
  (a cross-site form cannot set it; a cross-site `fetch` needs a preflight this server
  never approves) and, when the browser sends `Origin`, it must be this deployment.
  Origins are matched by **host, not host:port**, because the edge is free to terminate
  TLS on one port and forward to another; `APP_ORIGIN` adds a host the app could not
  guess. In development only, `*.cloudshell.dev` and `*.e2b.app` are accepted.
- The Express API is untouched: `Bearer` still works for `curl`, scripts and the future
  mobile app (ADR-0014), and `CORS_ORIGINS` remains for direct API clients. The web app
  no longer reads it, and browsers no longer need it.

**Consequences.** The web app's attack surface stops at its own origin: no token in
`localStorage`, nothing token-shaped in a response body, nothing for an intermediary to
strip, and refresh logic that cannot be reached or replayed from the client. Costs: the
web server is now on the authentication path (it already was on every data path), cookie
auth brings CSRF into scope, and a rotated refresh token has to be handled carefully
because **the API revokes every session for a user when a rotated refresh token is
presented again**. That last one was found by the browser acceptance run, not by unit
tests: a page load fires several requests at once, all carrying the same cookie value,
and the second rotation attempt logged the user straight out. Refreshes are therefore
deduped by token value — concurrent callers share one upstream call, and a token rotated
in the last 10 s is replayed from that result instead of being presented again
(`apps/web/src/lib/server/api-proxy.ts`). The behaviour is covered by tests.

**What was verified, and how.** Covered by unit tests with `fetch` mocked: token
injection, header dropping, allowlists, CSRF rejection, 401 → refresh → replay,
refresh refused → cookies cleared, token-minting paths blocked, single-flight refresh.
Covered in a real browser: a Playwright run against the app **behind a stand-in edge
that terminates TLS and deliberately strips `Authorization`** — sign in, dashboard data,
reload, transparent refresh of a deliberately corrupted access cookie, sign out, cookies
HttpOnly/`Secure`, no `Authorization` header from the browser on any of 120 requests, no
token in `localStorage`/`sessionStorage`, no token in any response body — 14/14 checks,
plus 7/7 over plain http (which is what proves a local `next dev` login still works).
**Not verified: Cloud Shell Web Preview itself.** The bug report came from an
environment this project has no access to; the stand-in reproduces the property it is
suspected of (header stripping) and nothing else, so the fix is "plausible and
well-tested", not "confirmed". `docs/LOCAL_DEV.md` carries the five-minute manual
checklist to close that gap. If cookies also turn out to be blocked by that edge, the
next step is not more guessing but a report of exactly what the browser saw.

---

## Deferred decisions (recorded, not yet made)

- **Mobile app** (`apps/mobile`, Expo): the API already supports it; deliberately not
  started in Phase 1.
- **S3 storage driver**: interface exists, driver deferred (ADR-0013).
- **PDF receipts/statements**: needs a font-embedding decision for Ethiopic script.
- **Multi-currency**: the model has one currency per organization this phase; a
  lease whose currency differs from the organization's is rejected. Real multi-currency
  would need exchange-rate history and a decision on which rate a payment uses.
- **Event streaming / analytics**: none. Reports are SQL over the operational tables;
  when that stops being fast enough, a read model will be added, not a second database.

## ADR-0027 — Landlords are not users; optional property blocks

Accepted for the hierarchy foundation requested on 2026-10-06. Owner is an
organization-scoped landlord record, not an auth identity or the owner_admin role.
Organization.portfolioMode is self_owned (default, hidden landlord) or managed
(explicit landlord selection). Registration accepts the mode; UI controls follow
in the next item-1 PR, before the full item-2 wizard.

Every property has an owner. Existing organizations receive one default owner named
after the organization; existing property links are backfilled without changing
leases, users or balances. Administrators must review these inferred assignments.
New registration creates a default owner from the signup profile in the same
transaction. Management fee is nullable integer basis points, 0–10000, stored only;
no charges, deductions, payouts or tax assumptions are introduced.

Building (also called Block) is optional. Units keep their property link and may
reference a building within that property. Composite foreign keys enforce owner
organization and building/property/organization consistency in addition to API
checks. Unit labels remain unique per property: use A-101/B-101 across blocks.
No destructive owner/block endpoints or runtime dependencies are added. Existing
local storage, bearer API and HttpOnly web sessions are unchanged.

## ADR-0028 — Patch Vitest's worker pool without upgrading the test framework

Accepted 2026-10-06. Pin `vitest>tinypool` to 2.1.2 to address
GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr (inherited options reaching worker
creation/run). No patched 1.x is available. The targeted override keeps Vitest 3
and the existing Node 20 baseline; Tinypool 2 supports Node 20. No production
package is added. Remove/revisit the override when upgrading Vitest.

Four lightweight Node tests resolve the actual pool used by Vitest and verify
inherited constructor/run options are ignored in worker-thread and child-process
modes; they also exercise worker recycling. They run in `pnpm test` without a
browser. The existing integration/component tests verify compatibility.

`pnpm audit --audit-level=critical` now passes. The CI threshold remains critical
(as already configured, correcting ADR-0018's older CI-command description).
Three moderate findings and one high tooling finding remain; the local `pnpm audit`
script still uses the stricter high threshold and can fail. This is not a clean
zero-advisory audit, and no findings are ignored or suppressed.

## ADR-0029 — Small hierarchy UI before the full onboarding wizard

Accepted 2026-10-06. Signup exposes the two portfolio modes using the existing
registration API. Properties contains the landlord section only for managed
portfolios with owners.read permission. Landlord create/edit controls require
owners.write; property/block writes and unit creation follow the shared RBAC matrix.
These visibility checks are usability only: API authorization remains authoritative.

Blocks are managed in a property-specific dialog. Unit creation resets its block
selection whenever the property changes, preventing stale cross-property selections.
Fee percentages are parsed as decimal text into integer basis points (no floating
point multiplication); clearing a fee sends null, not zero. No automatic fee billing.

Reuse the existing components and same-origin cookie API. No storage changes, new
dependencies, browser tests, or live preview stack. English keys are accompanied by
unreviewed am/om/ti machine drafts; native-speaker review is still required.

Changing portfolio mode after signup, property-owner reassignment UI, and moving
existing units between blocks are deferred; the corresponding backend hierarchy
links can already be updated by authorized API clients. This slice does not claim
the full item-2 wizard or item-3 redesign.

## ADR-0030 — Bounded, atomic bulk unit creation

Accepted 2026-10-06. Share naming validation/preview in the dependency-free shared
package. Exactly one literal `{n}`, no evaluated code, max 200 units per request.
Unique property labels and a transaction enforce all-or-none under concurrent
requests. Retry conflicts are explicit rather than silently skipping duplicates.
New units are vacant; leases remain the path to occupancy. No jobs or storage changes.

## ADR-0031 — Bounded CSV validation and atomic portfolio import

Accepted 2026-10-06. No CSV dependency: a strict, bounded state-machine parser in
shared supports BOM/CRLF, escaped quotes and embedded newlines; malformed input
is rejected. Templates define exact headers. Imports are capped at 200 rows and
256 KiB UTF-8. Unit labels reserve soft-deleted rows; tenant duplicate checks use
case-normalized names and normalized phone/email combinations, not inferred identity.

Separate validate/commit calls both validate server-side; writes and per-record
audit entries share one transaction. A per-org PostgreSQL advisory lock serializes
imports. An ImportBatch unique organization/content fingerprint prevents exact
replays including concurrent calls and server restarts. Ordinary tenant creation
remains unchanged. No source CSV, ID data or raw cell values are logged or retained
in import reports/batch metadata. No automatic record updates, leases or logins.

Validation results return HTTP 200 with valid=false and structured row errors;
auth/scope/input-envelope failures retain 4xx. Database races with other unit
writers can return 409 and roll back the entire batch. No silent partial success.
