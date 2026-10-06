# Tenant ID review — audited reveal and verification (item 4, slice 3)

Completes item 4's private-ID scope. Tenant ID numbers were already encrypted
at rest and masked in every list response; this slice adds the two missing,
documented workflows: an audited full-number reveal for the roles allowed to
see it, and staff verification of a document.

## Endpoints

| Endpoint                                                               | Permission         | Effect                                                         |
| ---------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------- |
| `GET /api/v1/tenants/:tenantId/id-documents/:documentId`               | `tenants.ids.read` | Returns the decrypted number; writes an audit row (`read_id`). |
| `POST /api/v1/tenants/:tenantId/id-documents/:documentId/verification` | `tenants.write`    | Sets/clears `verifiedAt`; writes an audit row (`verify`).      |

Both are organization-scoped; unknown or cross-organization documents return
404 without revealing existence.

## Tests

`apps/api/src/test/id-documents.test.ts` (6 tests): list masking never leaks
the number; reveal returns the number and an audit row that does **not**
contain it; accountants (same org, no `tenants.ids.read`) get 403 on both
endpoints while still reading the masked list; cross-organization reads 404;
verification toggles on and off with two audit rows; tenant-role sessions get
403 on verification.

## Docs

`docs/PRIVATE_ID_DOCUMENTS.md` is the standing reference for storage,
reading, review and the refusals built into the design. ADR-0038 records the
decision; tracker updated.

## PWA note (item 4 scope)

The portal pages are served by the same PWA shell already in place
(`manifest.webmanifest`, `sw.js`, `PwaRegister`, `/offline` fallback), so the
tenant portal installs and degrades offline like the rest of the app; no
additional work was required.

## Gates

Format, lint, typecheck, tests and the web build are all green.
