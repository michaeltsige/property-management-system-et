# Tenant portal web UI — OTP sign-in, portal page, staff enrollment (item 4, slice 2)

Builds on the portal API (see `TENANT_PORTAL_API_REPORT.md`). Tenants can now
sign in and read their portal page in the browser; staff can enable or revoke
portal access from the tenants screen.

## Tenant sign-in — `/portal/login`

Two steps, no password anywhere:

1. Phone number → `POST /api/session/portal-request`. The server answer is the
   same `{ ok: true }` whether or not the number rents anywhere, so the page
   can never hint at tenancy.
2. Six-digit code → `POST /api/session/portal-verify`. On success the session
   starts exactly like a password login: tokens become HttpOnly cookies on the
   server (ADR-0026 unchanged) and the browser stores identity only.

The verify endpoint returns the same identity shape as `/auth/login` (API
extended in this slice), so the preferences layer treats an OTP sign-in like
any other session.

## Portal page — `/portal`

Shows exactly what `GET /portal/me` returns and nothing more: the due balance
(with an "up to date" badge when it is zero) and the tenant's leases — unit,
property, rent, start date, status. Non-tenant sessions see a notice instead
of data, and an expired session returns to the portal login. All money is
rendered through `formatAmount` (minor units, BigInt-safe); dates through the
calendar-aware `formatDate`.

## Staff enrollment — tenants screen

A Portal column (visible with `tenants.write`) shows Enabled/Disabled and an
enable/disable button wired to `POST/DELETE /tenants/:tenantId/portal`. The
tenant list already carries `portalEnabledAt`, so no new endpoint was needed.

## Proxy hardening

`/portal/verify` joins `TOKEN_MINTING_PATHS`, so the browser-facing proxy
refuses to reach it directly — the only way in is `/api/session/portal-verify`,
which swaps tokens for cookies. `request-code` passes through verbatim to keep
the uniform answer intact.

## i18n

New `portal.*` keys plus `tenant.portal*` and `common.enabled/disabled` in en
(source of truth) with machine-draft translations in am/om/ti.

## Tests

- `api-proxy.test.ts`: +4 — request-code pass-through, verify cookie/identity
  handling, wrong-code pass-through, browser proxy blocked from `/portal/verify`.
- `portal/login/page.test.tsx`: +3 — phone→code flow, sign-in on verify, error
  display.
- API: verify response now asserts the login-shaped identity.

Gates: format, lint, typecheck, tests, web build — all green.
