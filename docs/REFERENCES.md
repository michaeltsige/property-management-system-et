# References

Every project below was cloned to `../_refs/` (outside this repository), read, and
then left behind. Nothing was forked, and no file was bulk-copied. This file
records the **license actually verified**, what was taken (idea vs. code), and what
was rejected — so a future reader can retrace the reasoning.

Rule applied throughout: **design ideas are reusable, code is not, unless its
license is compatible and the copy is recorded in `THIRD_PARTY_NOTICES.md`.

| Project                     | License (verified)                           | Method                                                                         | Outcome                          |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| `clawnify/OpenProperty`     | MIT (LICENSE in repo)                        | Read domain model, locale layout                                               | Ideas only                       |
| `GSLabIt/OpenProperty`      | MIT                                          | Read `src/server/schema.sql`, `it-fiscal.ts`, locales                          | Ideas only                       |
| `open-condo-software/condo` | MIT                                          | Read `packages/billing`, `packages/messaging`, `packages/locales`, `AGENTS.md` | Ideas only                       |
| `java110/MicroCommunity`    | Apache-2.0 (LICENSE in repo)                 | Read SQL schema, menu/permission mappers, report mappers                       | Ideas only                       |
| `java110/MicroCommunityWeb` | Apache-2.0 (LICENSE fetched from GitHub raw) | Read navigation/menu structure                                                 | Ideas only                       |
| Pronto Housing (product)    | Proprietary                                  | Product tour / concepts                                                        | Concepts only, no assets or text |

## What each one contributed

### OpenProperty (both forks) — lease-centric domain model

- A lease is the centre of the data model; money hangs off it as **charges** with
  period/amount/status and **payments** allocated to those charges. Adopted:
  `Charge(leaseId, periodKey, amountMinor, paidMinor, status)` and
  `PaymentAllocation`.
- `rent_due_day`, `late_fee`, `deposit` live **on the lease**, not on the unit.
  Adopted.
- The **country-localization pattern**: `it-fiscal.ts` keeps every Italian rule
  (ISTAT indexation, IMU, deposit interest) as pure functions with editable
  configuration strings, and the locales are split per entity.
  Adopted as a shape: this project keeps Ethiopian-specific rules in
  `packages/shared` (`UNVERIFIED_TAX_DEFAULTS`, late-fee configuration) as data
  with a `verified` flag, never as hardcoded logic.
- Rejected: their single-tenant schema (`settings` row per install) — this product
  is multi-organization from the first migration; their server-rendered EJS UI.

### open-condo (condo) — maintenance, notifications, i18n infrastructure

- **Ticket/maintenance flow**: status transitions, assignment to a contractor,
  resolution notes. Adopted as the `WorkOrder` state machine
  (`open → assigned → in_progress → on_hold → completed|cancelled`) enforced in the
  API, which is more explicit than a free-text status field.
- **Billing connector interface**: one interface, several provider adapters, with
  webhooks and reconciliation as part of the contract. Adopted: the payment
  provider interface with `initiate / verify / webhook / refund / reconcile` and
  `mock` + `telebirr` + `chapa` adapters (the latter two are intentionally
  unimplemented until official sandbox credentials and docs are available).
- **Notification templates per transport** (`lang/<locale>/<transport>/default.njk`)
  with a default fallback. Adopted as ICU templates stored under i18n keys
  (`notification.rent_overdue` etc.) resolved through the same override chain as the
  UI, with the provider adapter doing the rendering.
- **Translation linting** (missing keys, ICU argument drift). Adopted as
  `packages/i18n/src/lint.ts`, run in tests and CI.
- **Multi-organization access control** where every query is org-scoped. Adopted,
  and strengthened with explicit cross-org tests asserting **404, never 403**.
- **`AGENTS.md` conventions** — adopted as repository rules in `README.md`.
- Rejected: KeystoneJS 5 / Apollo / GraphQL, the Django-based migrator, and NATS as
  a transport (pg-boss over the existing PostgreSQL is enough at this scale).

### MicroCommunity / MicroCommunityWeb — feature checklist and navigation

- A catalogue of what a mature property-management suite contains: fees and
  arrears reports, repair orders, owner committees, parking, inspections.
  Adopted as a **checklist** to prioritise later phases (see `docs/ARCHITECTURE.md`,
  "Not in Phase 1").
- Menu grouping (portfolio / people / money / operations / administration) informed
  the sidebar navigation.
- Rejected: the Vue 2 frontend (end of life) — the UI here is React + Tailwind +
  shadcn-style components; no Vue code, markup or styles were copied. The Java
  backend was not used at all.

### Pronto Housing — product concepts

- Leasing funnel, renewal handling, and the idea of a per-property income
  statement as the owner's primary screen. Concepts only: no copy, screenshot,
  layout, icon or brand asset from the product appears in this repository.

## Fonts

- **Noto Sans Ethiopic** — SIL Open Font License 1.1, loaded from Google Fonts in
  development. Self-hosting is a Phase 2 task (ADR-0012).
