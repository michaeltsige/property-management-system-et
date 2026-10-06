# Item 1a — Owner hierarchy foundation

## 1. Delivered

Owner (landlord, separate from users), optional Building/Block, mandatory property
owner link, stored fee basis points, registration API mode, scoped CRUD and
transactional audit records. Migration backfills existing properties. No UI changes
yet: mode selection and owner/block controls are the next small PR within item 1.

## 2. Decisions

ADR-0027 documents defaults and compatibility. Unit labels stay unique per property.
The existing storage interface and dependency lockfile are unchanged.

## 3. Risks / human verification

Backfilled landlord names come from organization names and need administrator review.
No fee calculation or legal assumptions. The critical tinypool test-tooling
advisories are addressed by the separate test-pool fix (PR #10); the audit gate is unchanged.
Migration tested on an empty PostgreSQL database by the integration suite and on
a local pre-hierarchy demo database: 2 properties gained org-consistent owner links,
7 units, 3 leases and 7 ledger rows remained. Production data remains unverified; back up before deploy.

## 4. Verification

`pnpm test`: 241 Vitest tests + 4 worker regression tests passed (including 10 new hierarchy tests); full lint passed;
API typecheck passed. Tests cover registration defaults, owner visibility metadata,
fee validation, optional blocks, uniqueness, RBAC, cross-org isolation, wrong-property
blocks, and direct database constraint rejection. No browser/UI acceptance claimed.

Run `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm db:deploy`, then
`pnpm test` with TEST_DATABASE_URL configured to a database ending in `_test`.

## 5. Next small PRs (requested order)

1. Owner/block UI and signup mode; bulk unit naming; validated CSV units/tenants imports.
2. Full signup wizard and organization billing defaults.
3. Task-based navigation, closable workspace tabs, property switcher/search, dashboard
   and unit detail redesign. Reference screenshots welcome, not required to proceed.
4. Tenant portal and private ID collection/review with mock OTP.
5. Mock payments, proof approval, PDF documents and encrypted per-org credentials.
6. Contextual documents/checklists and expiry jobs.
7. Consent, self-hosted Ethiopic font and realistic seed data.
8. CI-only Playwright smoke suite, never in pnpm test or Cloud Shell bootstrap.

Keep each slice independently tested and documented. Optional module visibility is
not authorization and must not delete stored data. No parking/IoT/marketplace scope.
Reference projects are inspiration only; no assets, text, layouts or code copied.
