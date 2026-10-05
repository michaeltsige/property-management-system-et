# Roadmap

The Phase 0-6 plan, with honest status. Nothing moves to the next phase until the
previous one is approved.

| Phase | Deliverable                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Discovery: reference analysis, licences, feature matrix, domain model, MVP scope, screen plan, architecture, decisions                                                                                                                                                                 | **This PR**                                                                                                                                                                                                                      |
| 1     | Monorepo scaffold: pnpm + Turborepo, strict TS, ESLint/Prettier/Vitest, commitlint, Postgres compose, Prisma + first migration + seed, Express `/api/v1/health`, Next shell, shared packages used by both apps, CI, README                                                             | **Done** (PR #1)                                                                                                                                                                                                                 |
| 2     | Core domain and API: organizations/auth/RBAC/audit, properties/units, tenants/documents, leases, charges + ledger, maintenance + vendors, API docs, unit + integration + isolation tests                                                                                               | **Done** (PR #1)                                                                                                                                                                                                                 |
| 3     | Web UI: shell, dashboard with ECharts, screens for every entity, auth flows, states, filters, pagination, forms, PWA, accessibility                                                                                                                                                    | **Mostly done** (PR #1): all data screens exist; PWA, accessibility pass and dashboard polish remain                                                                                                                             |
| 4     | Localization and calendars: i18n framework, en complete, am/om/ti drafts marked unreviewed, DB overrides + Translation Manager, `packages/calendar` with Pagume/leap/boundary tests, billing calendar wired into generation, Ethiopic font, ETB formatting, missing-key CI check       | **Mostly done** (PR #1) + Cloud Shell dev tooling (PR #2): every item exists; a native review of the drafts is still needed, and the missing-English-key check runs as part of the i18n lint test rather than as a separate gate |
| 5     | Payments, notifications, jobs: provider interface + manual + Telebirr/Chapa, idempotent webhooks with signature verification, pg-boss worker (generation, reminders, overdue, late fees, reconciliation), notification service with translatable templates, tenant-facing payment flow | **Partial**: interface + manual + mock + worker + templates exist; live Telebirr/Chapa, webhooks and the tenant payment flow are blocked on official sandbox docs/credentials                                                    |
| 6     | Pronto-inspired workflows, reports, hardening: questionnaires/applications, document collection + e-signature acknowledgement, renewals, reports incl. PDF, OWASP review, dependency audit, backup/restore, deployment guide, final documentation and open-issues list                 | **Not started**                                                                                                                                                                                                                  |

## Work completed outside the phase order

Two things were done early because they unblock everything else, and both are
reviewable on their own:

- **Cloud Shell-ready local development** (PR #2): `pnpm dev:all` starts Postgres,
  migrates, seeds and runs api + worker + web; the browser reaches the API through the
  Next proxy on one port, so a preview proxy needs nothing but port 3000.
- **Dev-tuned resource limits** for a 2 GB VM, documented in `docs/LOCAL_DEV.md`.

## Sequencing decisions

- **Live payment providers (Phase 5) are gated on evidence.** Writing a Telebirr or
  Chapa adapter without official request/response and signature documentation would
  produce code that looks finished and fails in production. Until then the adapters
  throw a named "not configured" error and manual payments carry the product.
- **Phase 3's PWA and accessibility work moves with Phase 6's hardening**, because both
  need the screens to stop changing first.
- **No native mobile app**, per the plan's out-of-scope list. The REST API and the
  shared packages are already shaped for it.
- **Human verification runs in parallel, not at the end**: the tax/legal list in
  `docs/DECISIONS.md` needs a local accountant or lawyer, and the three draft
  catalogs need native reviewers, before any of it is used with real money.

## Open questions for the approver

1. Is the MVP scope in `docs/ARCHITECTURE.md` right, or should late fees and PDF
   invoices move into it?
2. Should Phase 3's PWA work happen before Phase 5's payments, or stay bundled with
   Phase 6 hardening?
3. Who reviews the Amharic/Afaan Oromo/Tigrigna catalogs, and against which glossary
   (in particular "arrears", "deposit", "notice period", "stamp duty")?
