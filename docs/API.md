# API reference

Base URL: `/api/v1`. JSON only. Authenticated endpoints take a bearer access token:

```
Authorization: Bearer <accessToken>
```

Money is **always** an object `{ "amountMinor": "1500000", "currency": "ETB" }` —
`amountMinor` is a decimal string because it is stored as an integer of santim
(1 ETB = 100 santim). Calendar dates are `"YYYY-MM-DD"` **Gregorian** ISO dates
unless a field name says otherwise (`civilDate` objects carry their own calendar).

Errors have one shape:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "human readable", "details": [] } }
```

Codes used across the API: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401),
`FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `BUSINESS_RULE` (422),
`RATE_LIMITED` (429), `INTERNAL` (500).

## Auth

| Method | Path             | Notes                                                                                       |
| ------ | ---------------- | ------------------------------------------------------------------------------------------- |
| POST   | `/auth/register` | Creates a user, an organization and an owner membership in one transaction. Returns tokens. |
| POST   | `/auth/login`    | `{ email, password }` → `{ tokens, user }`. Locked for 15 minutes after 10 failures.        |
| POST   | `/auth/refresh`  | Rotates the refresh token. Reusing a rotated token revokes the whole family.                |
| POST   | `/auth/logout`   | Revokes the presented refresh token.                                                        |
| GET    | `/auth/me`       | Current user, membership, organization, permissions.                                        |

## Health

| Method | Path            | Notes                                    |
| ------ | --------------- | ---------------------------------------- |
| GET    | `/health`       | Liveness. No auth.                       |
| GET    | `/health/ready` | Readiness: database round-trip. No auth. |

## Organizations and access

| Method    | Path                                   | Permission                                |
| --------- | -------------------------------------- | ----------------------------------------- |
| GET       | `/organizations`                       | authenticated                             |
| GET/PATCH | `/organizations/settings`              | `settings.read` / `settings.write`        |
| GET/POST  | `/organizations/members`               | `members.read` / `members.write`          |
| PATCH     | `/organizations/members/:membershipId` | `members.write` (role change, deactivate) |
| GET/POST  | `/organizations/id-types`              | `settings.read` / `settings.write`        |

## Portfolio

| Method   | Path                              | Permission                                                                    |
| -------- | --------------------------------- | ----------------------------------------------------------------------------- |
| GET/POST | `/properties`                     | `properties.read` / `properties.write`                                        |
| PATCH    | `/properties/:propertyId`         | `properties.write`                                                            |
| GET/POST | `/units`                          | `units.read` / `units.write`                                                  |
| PATCH    | `/units/:unitId`                  | `units.write`                                                                 |
| GET/POST | `/tenants`                        | `tenants.read` / `tenants.write`                                              |
| PATCH    | `/tenants/:tenantId`              | `tenants.write`                                                               |
| GET      | `/tenants/:tenantId/id-documents` | `tenants.read` (numbers decrypted; never audited in clear)                    |
| GET/POST | `/leases`                         | `leases.read` / `leases.write`                                                |
| GET      | `/leases/:leaseId`                | `leases.read` — the lease plus counters, unit, tenant, co-tenants             |
| PATCH    | `/leases/:leaseId`                | `leases.write`                                                                |
| POST     | `/leases/:leaseId/terminate`      | `leases.write` — frees the unit; optional deposit refund posts a ledger entry |

Query parameters on the list endpoints: `page`, `pageSize` (max 100), `search`,
plus per-resource filters (`status`, `propertyId`, `unitId`, `tenantId`). List
responses are `{ items, page, pageSize, total }`.

## Money

| Method | Path                               | Permission         | Notes                                                                                                                                           |
| ------ | ---------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/charges/generate`                | `charges.generate` | `{ periods: ["2019-01"], scope?: {...} }` → `{ created, skippedExisting, totals }`. Idempotent: re-running for the same period creates nothing. |
| GET    | `/charges`                         | `charges.read`     | Filters: `periodKey`, `leaseId`, `status`, `propertyId`.                                                                                        |
| POST   | `/charges/:chargeId/waive`         | `charges.waive`    | `{ reason }` → posts a credit ledger entry.                                                                                                     |
| POST   | `/leases/:leaseId/deposit-charge`  | `charges.generate` | Raises a security-deposit charge.                                                                                                               |
| GET    | `/leases/:leaseId/statement`       | `leases.read`      | Running balance in both calendars.                                                                                                              |
| POST   | `/ledger/entries/:entryId/reverse` | `ledger.reverse`   | Exact negation; the original entry is never modified.                                                                                           |
| POST   | `/payments`                        | `payments.write`   | Manual payment (cash, bank transfer, cheque) or provider-confirmed. Allocates oldest charge first.                                              |
| GET    | `/payments`                        | `payments.read`    | Filters: `leaseId`, `method`, `status`, `from`, `to`.                                                                                           |
| POST   | `/payments/:paymentId/reverse`     | `payments.reverse` | Reason required. Double reversal → 409.                                                                                                         |

Receipt numbers are sequential per organization and calendar year: `RCT-2026-000042`.

## Operations

| Method   | Path                                                  | Permission                                                                      |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET/POST | `/vendors`, PATCH `/vendors/:vendorId`                | `maintenance.read` / `maintenance.write`                                        |
| GET/POST | `/work-orders`, GET/PATCH `/work-orders/:workOrderId` | `maintenance.read` / `maintenance.write`                                        |
| POST/GET | `/documents`, DELETE `/documents/:documentId`         | `documents.read` / `documents.write`                                            |
| GET      | `/documents/:documentId/download`                     | `documents.read` (streams through the API; storage keys never leave the server) |
| GET      | `/notifications`                                      | `notifications.read`                                                            |
| POST     | `/notifications/send`                                 | `notifications.write` — renders the template in the recipient's language        |

Work-order status transitions are enforced: `open → assigned|in_progress|on_hold|cancelled`,
`assigned → in_progress|on_hold|cancelled`, `in_progress → on_hold|completed|cancelled`,
`on_hold → in_progress|cancelled`. Ticket numbers are `WO-2026-000042`.

## Reports

| Method | Path                   | Notes                                                                           |
| ------ | ---------------------- | ------------------------------------------------------------------------------- |
| GET    | `/reports/summary`     | Dashboard: portfolio counts, expected vs collected, arrears, work-order counts. |
| GET    | `/reports/rent-roll`   | Per lease for a period: billed, collected, balance, status.                     |
| GET    | `/reports/arrears`     | Aged buckets (current, 1–30, 31–60, 61–90, 90+).                                |
| GET    | `/reports/occupancy`   | Per property: units, occupied, vacant, rate.                                    |
| GET    | `/reports/collections` | Monthly collections for the last `months` periods, in the requested calendar.   |

All reports accept `calendar=ethiopian|gregorian` and return period keys in that
calendar; adding `format=csv` returns a CSV download with the same columns the web
UI shows.

## Translations

| Method | Path                         | Permission           | Notes                                                                            |
| ------ | ---------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| GET    | `/translations`              | `translations.read`  | Every key with English, the current text and where it came from. `?language=am`. |
| GET    | `/translations/lint`         | `translations.read`  | Missing/empty keys, ICU argument mismatches, coverage per language.              |
| GET    | `/translations/export`       | `translations.read`  | `?language=am&template=1` → CSV (`key,language,status,text,organization_id`).    |
| POST   | `/translations/import`       | `translations.write` | CSV body; rows are validated, written as overrides and versioned.                |
| PUT    | `/translations/:key`         | `translations.write` | Upsert an override for the current organization.                                 |
| DELETE | `/translations/:key`         | `translations.write` | Removes the override (the shipped catalog shows through again).                  |
| GET    | `/translations/:key/history` | `translations.read`  | Revision history with authors and timestamps.                                    |

Sources reported per key: `organization_override`, `global_override`, `catalog`,
`english_fallback`, `missing`. Statuses: `machine_draft`, `unreviewed`, `reviewed`.

## Payments webhooks (adapter layer, no HTTP route yet)

The provider interface (`apps/api/src/providers/payments/types.ts`) implements
`initiate`, `verify`, `handleWebhook`, `refund` and `reconcile`, and the mock
adapter signs webhook bodies with HMAC-SHA256 (`x-mock-signature`). The HTTP
endpoint that receives provider callbacks is deliberately **not exposed in Phase 1**:
the Telebirr and Chapa adapters throw `PROVIDER_NOT_CONFIGURED` until their request
envelopes and signature schemes are confirmed against official sandbox
documentation, and exposing an unverifiable callback would be a security hole.
Manual payment recording is fully functional, so the product is usable today.

## Background jobs (not HTTP)

Queues run in `apps/api/src/worker.ts` only:

```
pnpm --filter @pms/api worker                    # long-running worker
pnpm --filter @pms/api worker -- --once=charges.generate
pnpm --filter @pms/api worker -- --once=charges.overdue-sweep
pnpm --filter @pms/api worker -- --once=notifications.send
```
