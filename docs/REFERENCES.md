# References

Phase 0 discovery. Every project below was cloned to `../_refs/` (outside this
repository), read, and left behind. Nothing was forked and no file was bulk-copied.

Legend for "Taken": **idea** = a concept, pattern or checklist informed our design;
**code** = source lines copied — this column is empty for every reference.

| Reference                   | License (verified from the LICENSE file)                                      | Taken         |
| --------------------------- | ----------------------------------------------------------------------------- | ------------- |
| `clawnify/OpenProperty`     | MIT — `LICENSE` line 1-3: "MIT License / Copyright (c) 2026 Clawnify"         | idea          |
| `GSLabIt/OpenProperty`      | MIT                                                                           | idea          |
| `open-condo-software/condo` | MIT                                                                           | idea          |
| `java110/MicroCommunity`    | Apache-2.0                                                                    | idea          |
| `java110/MicroCommunityWeb` | Apache-2.0 — `LICENSE` line 1-2: "Apache License / Version 2.0, January 2004" | idea          |
| Pronto Housing (product)    | Proprietary                                                                   | concepts only |

---

## 1. clawnify/OpenProperty (upstream)

**Stack.** React 19 + Vite, Tailwind v4, shadcn-style Radix components, Hono on
Cloudflare Workers, D1 (SQLite). `wrangler dev` for the API, `wrangler d1 execute`
for migrations, `zod` for request validation.

**Structure.** `src/server/{index.ts,schema.sql,db.ts}` — a single 949-line Hono app
plus one 170-line DDL file; `src/client/components/<entity>/` — one folder per entity
(`properties`, `tenants`, `leases`, `rent`, `maintenance`, `settings`) with a list,
a page and a dialog per entity; `src/client/locales/*` (in the fork, not upstream's
focus).

**Data model.** 11 tables, all integer-PK, `TEXT` dates:

- `properties` (name, type, address, city, state, zip, year_built, color)
- `units` (property_id, name, bedrooms, bathrooms, sqft, market_rent, status)
- `tenants` (first/last name, email, phone, dob, emergency_contact, employer,
  monthly_income)
- `leases` (unit_id, primary_tenant_id, start_date, end_date, monthly_rent, deposit,
  **rent_due_day**, late_fee, status), plus `lease_tenants` for co-tenants
- `rent_charges` (lease_id, **period `YYYY-MM`**, due_date, amount, amount_paid,
  status `open|partial|paid|overdue|waived`), unique on `(lease_id, period)`
- `payments` (**charge_id**, paid_at, amount, method, reference)
- `vendors` (name, category, phone, email)
- `work_orders` (property/unit/tenant/vendor ids, title, description, priority,
  status, scheduled_at, completed_at, cost)
- `applications` (manual entry only; status `new|screening|approved|declined|withdrawn`)
- `settings` (key/value)

**Rent policy fields.** `leases.monthly_rent`, `leases.rent_due_day` (1-31),
`leases.late_fee`, `units.market_rent`, and a global `settings.default_rent_due_day`.

**Charge generation** (`POST /api/rent-charges/generate`): for each lease with
`status = 'active'`, skip if `end_date < period-start`, compute
`due_date = "${period}-${rent_due_day}"` and insert
`ON CONFLICT(lease_id, period) DO NOTHING`. There is no pro-rating, no clamping of an
impossible due day (a lease due on the 31st produces `2026-02-31`), no grace period,
and no automatic late fee — `late_fee` is stored but never applied by code.

**UI.** Single-page shell with a sidebar and per-entity list → detail → modal-editing
pattern; stat cards on a dashboard; rent page grouped by period; maintenance board
grouped by status. Plain English labels, no i18n, no calendar options, USD-shaped.

### Honest assessment

**Quality.** Clean, readable, consistent — a good _shape_ to study. Every entity
follows the same list/page/dialog convention, validation is centralised with zod, and
the schema comments explain intent. The whole backend is one file, which is fine at
this size and would not survive a second developer.

**Gaps.** No pro-rating, no grace period, no late-fee application, no deposit
tracking on the ledger, no receipts, no reports beyond list screens, no documents, no
notifications, no audit log, no soft delete, no jurisdictions, no multi-currency, and
no calendar concept at all.

**Security.** The decisive finding: **there is no authentication and no
authorisation anywhere in the codebase** (grep for `auth`, `password`, `session`,
`token`, `jwt` in `src/server/index.ts` returns nothing). Every endpoint is public to
anyone who can reach the worker, including `DELETE /api/properties/:id`. There is no
CORS allowlist, no rate limiting, no request-size limit and no audit trail. It is a
single-tenant, single-operator tool by construction.

**What we took:** the charges-with-a-period-key idea and the
`UNIQUE(lease_id, period)` idempotency trick; the entity list/page/dialog UI
convention; the `rent_due_day`-on-the-lease placement.

**What we rejected:** SQLite/D1 and Workers, floats for money (`REAL`), public
endpoints, the "one file" backend, unvalidated `due_date` strings.

## 2. GSLabIt/OpenProperty (Node + Postgres fork)

**Stack.** Same client as upstream, but Node + Postgres server
(`src/server/node.ts`, `db.ts`), a separate `schema-it.sql`, and a genuine
country-localisation module.

**Localisation pattern (the interesting part).** `it-fiscal.ts` keeps every Italian
rule as pure functions over a parsed config: `parseCfg(raw)`, ISTAT indexation
(`istatPct`, `istatNewRent`), IMU property tax (`imuRateFor`, `imuUnit`), registration
tax and landlord share, plus `leaseDeadlines()` returning dated obligations. Values
come from a `settings` key/value table (`DEFAULT_CFG_RAW`), so rules are **data, not
code** — this is the pattern we mirrored for Ethiopia (configurable, `verified:false`
tax rules).

**i18n.** `src/client/i18n.ts` with `Lang = "it" | "en"`, an `it`/`en` locale module
per entity (`locales/leases.ts`, `rent.ts`, …) and a `t("{total} total · {active} active", vars)`
function. The catalogs are keyed by the **English sentence** with `{var}` markers —
convenient, but a rename of the English string breaks every translation, and the same
sentence in two contexts collides. We took the "one catalog per domain area" idea and
rejected sentence keys in favour of stable identifiers (`lease.status.active`).

**Same gaps as upstream** (no auth, no reports, no documents), plus: the fork keeps
float money (`REAL`) and ADR-style docs are absent.

## 3. open-condo-software/condo

**Scope.** A very large multi-app platform (30+ apps: `billing-connector`,
`accruals-gateway`, `debt-management`, `documents`, `employee-bot`, `miniapp`, …;
packages incl. `billing`, `messaging`, `locales`, `webhooks`, `keystone`, `migrator`).

**License.** MIT (`LICENSE` in repo root).

**What we studied.** `packages/billing` for the connector interface shape
(one interface, provider adapters, reconciliation as part of the contract);
`packages/messaging` (core + adapters + hooks + middleware + plugins) for how
notifications are split from transports; `packages/locales` plus `docs/localization.md`
for per-transport template files with a `default.njk` fallback and _translation
linting_; Keystone's `access.js`/`customAccess.js` for declarative, per-role access
expressions.

**What we took:** ticket/work-order lifecycle thinking, connector-style payment
provider interface, notify-vs-transport separation, translation linting, the
idea of an `AGENTS.md` for repository conventions.

**What we rejected:** its stack (KeystoneJS 5, Apollo/GraphQL, a Django-based
migrator, NATS). Rewriting our domain onto those would be a stack-changing decision
for no product gain at this scale.

## 4. java110/MicroCommunity (backend) and MicroCommunityWeb (frontend)

**License.** Apache-2.0 for both — verified in each `LICENSE` file (the web repo's
LICENSE was read from the GitHub copy; the Gitee copy no longer exists).

**Stack.** Backend: Java, Spring Cloud/Boot, MyBatis mappers, MySQL. Frontend:
a Vue 2 single-page admin served by a tiny Express app (`app.js`, `bin/www`,
`public/`), with `public/bigScreen` (a TV dashboard) and `public/h5` (a small-screen
variant). The web app is a shell that calls the Java services through a proxy.

**Product features (from `Readme_en.md`):** real estate, owners, fees with online
payment, repair requests, complaints and suggestions, procurement, inspections,
parking, gates, monitoring, workflow, **questionnaires**, and announcements.

**Navigation IA (from the `m_menu` table in
`java110-interface/docker/mysql/create_sql20190212.sql`).** Menus are rows with
`level`, `parent_id`, `seq` and `menu_group` (`LEFT` = the sidebar), seeded by
`INSERT`s — i.e. navigation is **data**, extensible per deployment, and permissions
hang off the same tree. Top-level groups are administration-shaped (system
configuration, cache management, …) with per-module trees beneath; screens are
grouped by business area rather than by entity.

**Reporting.** `java110-db/.../mapper/report/` holds report mappers such as
`ReportOwnerPayFeeServiceDaoImplMapper`, `ReportOweFeeServiceDaoImplMapper`
(arrears), and `ReportOrderStatisticsServiceDaoImplMapper` (work orders) — a useful
checklist of what an operations team actually asks for.

**What we took:** the feature checklist (especially questionnaires/e-signature,
inspections, parking, big-screen dashboard) and the grouping of navigation into
business areas with permissions attached to the same tree.

**What we rejected:** the entire technical stack, the Vue 2 frontend (end of life),
and the Chinese-only UI conventions. Our UI is React + Tailwind and is written from
scratch.

### MicroCommunityWeb licence — what is and is not permitted

Permitted (Apache-2.0): use, copy, modify, distribute and sublicense the code,
including commercially, provided that (a) the Apache-2.0 licence text and the
NOTICE file (if the work includes one) are retained, (b) modified files carry a
prominent notice of change, and (c) any patent claims you hold over your
contributions are not asserted against users of the work.

Not permitted: using the project's **name, logo, screenshots or branding** as if it
were ours; and claiming endorsement. There is no trademark grant in Apache-2.0.

**Our position:** we copied **no code, markup, style, image or text** from either
MicroCommunity repository. Only the navigation grouping and the feature list informed
our plan — neither is copyrightable expression, and we say so explicitly here so
there is no ambiguity later. If any file is ever copied, it must be added to
`THIRD_PARTY_NOTICES.md` with source path, licence and the change notice.

## 5. Pronto Housing (product, proprietary)

Concepts only: the leasing funnel, per-property income statement as the owner's
primary screen, and application → screening → approval → e-signature as one flow.
No code, text, screenshot, icon or brand asset was taken. Nothing from it may be
copied; these are generic industry workflows.
