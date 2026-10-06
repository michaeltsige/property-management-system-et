# Private tenant ID documents — how sensitive data is handled

Tenant identity numbers (kebele ID, passport, driving licence…) are the most
sensitive data in this system. This document is the single reference for how
they are stored, shown, read and reviewed.

## Storage

- Numbers are **encrypted at rest** (`encryptField`, AES-GCM via
  `apps/api/src/lib/crypto.ts`) in `TenantIdDocument.numberEncrypted`. The
  plaintext never touches the database.
- Only the **last four digits** are stored in the clear (`numberLast4`) so
  staff can tell documents apart without decrypting anything.
- The encryption key comes from `FIELD_ENCRYPTION_KEY` (environment, never in
  the repository). Rotating it requires re-encrypting rows — plan it as a
  migration, not a config flip.

## Reading

| Surface                              | What it shows                                  | Permission         |
| ------------------------------------ | ---------------------------------------------- | ------------------ |
| `GET /tenants/:id/id-documents`      | `****` + last 4, issuer, dates, verified state | `tenants.read`     |
| `GET /tenants/:id/id-documents/:doc` | The full decrypted number                      | `tenants.ids.read` |

Rules enforced by the API (not just the UI):

1. **Masking is the default.** List endpoints never return the ciphertext or
   the plaintext — only the masked form.
2. **The reveal is a separate, named endpoint.** It cannot happen by accident
   through a generic serializer; it exists in exactly one place.
3. **Every full-number read is audited** (`action: 'read_id'`) with the actor,
   document type and last four — never the number itself. The audit trail
   proves who saw what without recreating the leak.
4. **Organization scoping applies.** A document is only ever resolved inside
   the requesting organization; cross-organization reads get a 404, so other
   organizations' documents are not even acknowledged to exist.

Roles today: `owner_admin` and `manager` hold `tenants.ids.read`;
`accountant`, `maintenance` and `tenant` do not.

## Review

Staff verify a document against the physical original with
`POST /tenants/:id/id-documents/:doc/verification` (`tenants.write`), setting
or clearing `verifiedAt`. Each change is audited (`action: 'verify'`). The
document's content is never modified by review.

## Web behaviour

- The tenants screens show only the masked form.
- Full numbers are not rendered in the current UI; the reveal endpoint exists
  for the documented, audited cases when a staff member with the permission
  must compare the number against a physical document (and for future
  tooling). Until a reviewed UI exists, use the API deliberately, not
  casually — the audit row carries your name.

## What this design refuses to do

- No full number in logs, audit payloads, error messages or list responses.
- No full number for roles without `tenants.ids.read`, even inside the same
  organization.
- No acknowledgement that a document exists in another organization.
