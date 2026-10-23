# Upload Authorization Audit

**Date:** 2026-10-20 · **Scope:** owner review item ⑨ — "upload authorization end-to-end audit".
**Method:** read every document/storage route and guard (`apps/api/src/routes/operations.ts`, `routes/portal.ts`, `storage/index.ts`, `middleware/*`, `packages/shared/src/permissions.ts`), then verified behaviour with a new regression suite (`apps/api/src/test/tenant-role-surface.test.ts`).

## Findings

### F1 — Tenant sessions could read the organization's entire file cabinet (critical, fixed)

`GET /documents`, `GET /documents/:id/download` are guarded by `documents.read` and scoped to the
organization — deliberately, because staff work across the whole portfolio. The `tenant` role held
`documents.read` (plus `leases.read`, `charges.read`, `payments.read`, `org.read`), and nothing in
the staff routes narrows the query by tenancy. An enrolled tenant could therefore list and download
every other tenant's lease agreements and ID scans in the same organization.

**Fix:** the tenant role now holds only the three portal permissions (`portal.use`,
`portal.pay`, `portal.request_maintenance`). Tenant-facing data flows exclusively through the
tenancy-scoped `/portal/*` routes, which resolve the tenant from the session (`portalTenant()`),
filter by `tenantId`/own leases/own units, and 404 on anything else. Staff list endpoints now
reject tenant sessions with 403. Pinned by tests: five staff lists 403, portal surfaces 200.

### F2 — Portal document scoping is correct (verified, now tested)

`GET /portal/documents` and the download route scope by "filed against me, one of my leases, or one
of my units" and re-check the same predicate before streaming bytes. A document filed against
another tenant in the same organization is excluded from the list and returns 404 on direct
download. This behaviour existed but had no test — `tenant-role-surface.test.ts` covers it now,
including the second-tenant-in-same-org case the isolation suite did not exercise for documents.

### F3 — Storage layer defenses (verified, adequate for the threat model)

- `LocalStorageDriver` resolves and contains every key under `STORAGE_LOCAL_DIR/<org>/…` — path
  traversal (`../`) is rejected (`storage/index.ts:71-79`); user-supplied filenames never reach
  the filesystem (uuid + safe extension).
- MIME whitelist (`ALLOWED_UPLOAD_MIME_TYPES`) and size cap (`MAX_UPLOAD_BYTES`, 10 MB default)
  are enforced inside the driver, so every entry point (staff documents, payment proofs, future
  callers) inherits them. Empty payloads rejected; SHA-256 checksum stored.
- Downloads always re-check authorization per request; there are no unauthenticated signed URLs.

**Known limitation (accepted, documented):** the MIME type is client-claimed — no magic-byte
sniffing or virus scan. This matches the product's risk profile (single-tenant org deployment,
staff-uploaded files, whitelisted office formats). Revisit if the S3 driver goes live for
multi-org sharing.

### F4 — Permission matrix drift (minor, fixed)

`portal.request_maintenance` existed in the matrix but the portal filed requests through
`portal.use`. `POST /portal/maintenance-requests` now requires
`portal.request_maintenance` (no behaviour change today — only the tenant role holds it — but the
matrix and the routes now agree, and an org that someday disables the permission gets the right
result).

### F5 — Payment proofs (verified)

Tenant proof uploads go through `POST /portal/payment-proofs` (`portal.pay`): the tenant row is
resolved server-side, amounts/method/reference validated by schema, bytes stored as a
`payment_proof` Document linked to the attempt. Staff approve/reject through the payments flow
(`payments.record`). Covered by `portal-payments.test.ts` and `payment-proofs.test.ts`; no gaps
found beyond F1's general role issue.

## Verification

- New suite: `pnpm --filter @pms/api test -- src/test/tenant-role-surface.test.ts` (3 tests).
- Full API + web suites green; no other test relied on the removed tenant permissions.
