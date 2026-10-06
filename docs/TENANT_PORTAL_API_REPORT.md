# Tenant portal API — OTP login, enrollment, self-service read (item 4, slice 1)

## What this slice delivers

Tenants can now reach their own portal page without ever holding a password.
Staff enroll a tenant; the tenant signs in with a one-time code sent by SMS
(mocked through the existing notification queue); the tenant can then read
their leases and due balance — nothing else.

### Endpoints

| Endpoint                                  | Auth                | Purpose                                                                 |
| ----------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `POST /api/v1/tenants/:tenantId/portal`   | `tenants.write`     | Enroll a tenant; idempotent (re-running replays the welcome, no dupes). |
| `DELETE /api/v1/tenants/:tenantId/portal` | `tenants.write`     | Revoke the portal account (membership inactive, user deactivated).      |
| `POST /api/v1/portal/request-code`        | none (rate limited) | Send an OTP to an enrolled tenant's phone.                              |
| `POST /api/v1/portal/verify`              | none (rate limited) | Consume the OTP and issue the standard token pair (`role: tenant`).     |
| `GET /api/v1/portal/me`                   | `portal.use`        | Tenant's leases (unit/property names, rent, dates) plus due balance.    |

### OTP rules

- Six random digits (`crypto.randomInt`), stored only as SHA-256 hashes.
- Valid 10 minutes, single-use, five wrong-guess budget, 60-second resend
  cooldown (latest non-consumed code wins).
- `request-code` is enumeration-safe: unknown or unenrolled numbers receive the
  same `{ ok: true }` response and nothing is sent.
- Codes travel through the existing `Notification` pipeline (`channel: sms`,
  key `notification.portal_otp`, translated in en/am/om/ti), so they flow
  through the same mock SMS worker as everything else.

### Enrollment model

Enrollment creates a tenant-scoped `User` (`portal-<tenantId>@tenants.invalid`)
with a random unusable password and links it to the `Tenant` row
(`Tenant.userId`, unique). A `tenant`-role membership is added to the tenant's
organization. The tenant role already exists with a read-only permission set
(`portal.use`, `leases.read`, `charges.read`, `payments.read`,
`documents.read`, `org.read`), so the standard auth pipeline — token claims,
membership re-read, org scoping — applies unchanged. Revoking sets the
membership to `inactive` and deactivates the user; existing OTPs are unusable
because verify requires an active enrollment.

### Schema change

Migration `20261006111000_tenant_portal`: `Tenant.userId` (unique, nullable,
`SetNull` on delete), `Tenant.portalEnabledAt`, and a `TenantOtp` table
(`tenantId`, `codeHash`, `attempts`, `expiresAt`, `consumedAt`, `notificationId`,
indexed on `[tenantId, consumedAt]`).

## Tests

`apps/api/src/test/portal.test.ts` (7 tests) covers: enrollment idempotence and
unusable password; disable revoking the account; `tenants.write` + org-scope
enforcement; enumeration-safe request-code; single-use verify with audit login
row; five-guess lockout; tenant self-service scoping (`/portal/me` only, staff
endpoints 403, staff sessions get 404 on `/portal/me` because no tenant is
linked — no existence leak).

## Follow-ups (next slices of item 4)

- Web portal UI (tenant login + portal page) and staff enrollment controls.
- Enrollment review/private-ID docs and PWA hardening.

## Gates

`format:check`, `lint`, `typecheck`, `test` and the web build are all green.
