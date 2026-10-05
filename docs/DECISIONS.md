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
