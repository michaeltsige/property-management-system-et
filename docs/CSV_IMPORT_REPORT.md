# Item 1d — Validated unit and tenant CSV imports

## 1. Delivered

Separate CSV import dialogs in Units and Tenants: template download, UTF-8 file
or pasted text, validate first, then confirm. Errors show logical row and field,
with a spreadsheet-safe CSV error report. Units use the selected property and
optional block; tenant CSVs contain profile/contact fields only. Source files are
not retained. Existing private-document storage remains behind its interface.

API: `POST /api/v1/imports/units` and `/imports/tenants`; Zod schemas, strict quoted
CSV parser, max 200 data rows / 256 KiB, atomic audited writes, repeat protection
through the new organization-scoped ImportBatch fingerprint table.

## 2. Decisions

ADR-0031. Exact header order from the downloadable templates. Blank optional cells
become null/default. Integer santim only; no decimal-money inference. Units start
vacant and tenant import creates neither login nor lease. Import validates again
at commit, even if the client previously validated. No extra dependencies.

## 3. Risks and limitations

Only UTF-8 comma-delimited CSV; no Excel workbook or delimiter guessing. Row numbers
are logical CSV records (header is row 1), not physical lines inside quoted cells.
Tenant duplicate matching uses normalized name/contact combinations; it does not
prove identity. Exact-content replays are blocked persistently; files with changed
content are validated as new batches. Existing names without contact info may
need manual review. No automatic update/merge of existing rows.

Per-organization import transactions serialize duplicate checks; ordinary manual
single-tenant creation is not governed by a new identity uniqueness rule. Source
CSV and cell values never enter error reports or batch metadata. The downloaded
report belongs to the user's device. Non-English UI strings remain unreviewed
machine drafts. API error messages are English; no real-browser or Cloud Shell
acceptance claimed. Moderate/high test-tooling audit findings remain documented.

## 4. Verification

`pnpm test`: 282 Vitest tests + 4 Node worker regression tests pass. Shared
parser/schema and API integration tests, plus component tests
for validate-before-commit, stale-validation reset and error rendering. Covers
quoted commas/newlines/BOM/CRLF, malformed quotes, limits, money/phone normalization,
unknown ID columns, duplicates, atomic rollback, exact concurrent replay, RBAC,
cross-org property access, wrong-property blocks and organization-scoped fingerprints.

Run migrations with `pnpm db:generate && pnpm db:deploy`, then `pnpm test`.
API/web typecheck, full lint, formatting, production web build and the unchanged
critical audit gate are checked separately with no development servers running.

Manual check: download each template, add valid rows, Validate (no records created),
Import (records appear), resubmit unchanged (no duplicates), then try a bad phone,
a duplicate unit label and an invalid column. Download the report, correct the file,
validate again. Source file is not added to Documents or local disk storage.

## 5. Next

Review CSV behavior in Cloud Shell. Item 1 now has hierarchy, UI, bulk naming and
CSV slices. Full owner/admin onboarding wizard is next in the requested order,
not started in this PR.
