# Agent Handoff Log

> **Rule for any agent working in this repo:** after every user prompt you process and every significant action you take, update this file — fix [Current State](#2-current-state) and append a row to the [Update Log](#7-update-log) — then commit. Docs-only handoff updates may be pushed straight to `main`; all code changes still go through pull requests with CI green. Keep it accurate: this file is how work continues across agents. Never write secrets (tokens, passwords) into this file.

## 1. Project

Ethiopian property management system. Single pnpm + Turborepo monorepo.

- Repo: `https://github.com/michaeltsige/property-management-system-et`
- `apps/web` — Next.js staff app + tenant portal (shared component kit, i18n EN/AM/OM/TI, Gregorian/Ethiopic calendars)
- `apps/api` — REST API (`/api/v1/...`) with Prisma + PostgreSQL, role/permission enforcement, audit log
- `packages/shared` — schemas/types (must `pnpm turbo run build --filter=@pms/shared` after editing)
- `packages/i18n` — 4-language catalogs (`pnpm build` after editing; duplicate object keys fail the build)
- `packages/calendar` — date/calendar conversion
- `docs/FEATURES.md` — feature inventory; `docs/DECISIONS.md` — ADRs (stack changes need an ADR + owner approval)

## 2. Current State

- **Last verified:** 2026-10-08, `main` = `d668b35`
- **Open PRs:** none
- **Latest merges:** #43 PDF receipts + ADR-0028 (pdfkit + embedded Noto Sans Ethiopic at `apps/api/assets/fonts/`, staff + tenant receipt routes, `d668b35`) · #42 proof-of-payment upload + staff approval (`PaymentProof` model + migration, review queue, single recording path via `recordPaymentInTx`, `7354ef2`) · #41 tenant portal payment flow (initiate → mock checkout → complete, oldest-first allocation, ledger + receipt, `594b5ad`) · #40 logic audit · #39 handoff doc · #38 UI polish · #37 Organization section · #36 UX fixes · #35 brand · #34 FEATURES.md
- **Resolved owner questions:** tenant-portal login works only for enrolled tenants; demo seed = Almaz Bekele `+251911000001` (dial `0911000001`), OTP prints in worker log (mock SMS).
- **Portal payments (from #41):** tenants pay the full or a partial outstanding balance through the active provider (mock in dev). Intent lives in a `pending` Payment row; completion re-verifies with the provider before recording. Superseded attempts become `failed`. Mock checkout page: `/portal/pay/mock?ref=…`.

## 3. Environment & Commands

- Git identity: `Michael Tsigie <michaeltsige11@gmail.com>`. Push with a fine-grained token passed via the `GIT_TOKEN` env var only — never print, log, or commit it. On auth/permission errors: stop and report, no workarounds.
- Gates before any push: `pnpm turbo run lint typecheck` and `pnpm test` (root), plus `pnpm --filter @pms/web build` when UI changed. All must pass.
- Test DB: PostgreSQL at `postgresql://pms:pms@localhost:5432/pms_test`; run `pnpm exec prisma migrate deploy` in `apps/api` after DB changes. If PostgreSQL is missing, reinstall via apt and recreate role/db.
- Dev stack: `scripts/dev-all.mjs` — keep machine-agnostic (`CLOUD_SHELL=true` extras only in Cloud Shell; works on the owner's Debian VMware VM).
- PR workflow: branch per slice → short imperative conventional commit (no body) → push → open PR → watch CI → squash-merge. Watch CI to completion on both test runs before merging.

## 4. Standing Rules (from the owner)

- Only this repo is modified. Reference projects are read-only.
- No AI-generated images anywhere (real photography only); logo stays vector SVG.
- Language is fully English OR fully Amharic/etc. per UI — no bilingual "English / አማርኛ" strings in controls (e.g., region dropdown shows one language per UI language).
- Maintenance is tenant-initiated, staff-managed — staff never create requests.
- Billing calendar defaults are an org-level owner decision (Organization screen).
- Amharic month names in Ethiopic script (መስከረም, ጳጉሜን…), never transliterated.
- No database resets/reseeds to fix bugs; diagnose from evidence, fix properly, explain the cause.
- Stop-and-ask only for: credentials/access, license uncertainty, destructive actions, stack changes. No large deletions without asking.
- UI must not look "vibecoded": no decorative gradients/glass/nested cards/icon grids; one primary action per screen; consistent tokens; real empty/loading/error states on both owner and tenant sides.
- Demo/preview stack: don't restart unless asked.

## 5. Remaining Roadmap

1. Mock payment completion; proof-of-payment upload + approval; PDFs; org gateway secrets.
2. Contextual documents, checklists, lease/contract expiry reminders.
3. Consent handling, self-hosted fonts (see ADR-0012), realistic seed data.
4. Playwright tests running CI-only.

## 6. Known Pitfalls

- Moving/deleting Next.js pages leaves stale `.next/types` that break `tsc` → `rm -rf apps/web/.next` first.
- i18n: check for existing keys before adding (duplicate keys fail the build, TS1117); rebuild the i18n package after catalog edits.
- `@pms/shared` needs a dist rebuild before `apps/api` sees new exports.
- Sandbox resets can wipe PostgreSQL and git identity — verify before assuming.
- Never pipe a commit/push into `tail` in a way that hides its exit status; verify both test runs in CI.
- Never commit a second unrelated slice onto a branch that already backs an open PR — cut a new branch.
- Don't use `npx tsc` (resolves a fake package); use `pnpm exec tsc`.

## 7. Update Log

| Date (local, EAT) | Prompt / action | Outcome |
| --- | --- | --- |
| 2026-10-08 | Owner: add this handoff doc and keep it updated after every prompt/action | Created `docs/AGENT_HANDOFF.md`, merged to `main` via PR #39 (`5da6f27` → `dc26359` handoff log update) |
| 2026-10-08 #2 | Owner: run iterative check on whole code — find logical errors, nonsensical flows, optimize without restructuring | **Branch `fix/logic-audit` → PR #40 merged as `48f5d22` (11 files):** 1) Portal `findEnrolledTenantByPhone` now filters `user.isActive` + re-enroll reactivates; 2) `portal/me` dueMinor fixed from `['pending','overdue']` (nonexistent → always 0) to sum outstanding on `open`/`partial`; 3) `waiveCharge` now always `waived` (was `partial` for partial pays); 4) `amountForPeriod` now handles lease `endDate` + multi-month span; 5) `createDepositCharge` deduped + auto-wired into lease create & activation; 6) `recordPayment` now requires lease/tenant/allocation + rejects waived/written_off; 7) Late fees now applied via `applyLateFees()` in `overdue-sweep`; 8) `reports/summary` expectedMinor now excludes `waived`; 9) `generateCharges` period span fixed for quarterly/annual; 10) Leases list N+1 → single `groupBy`; 11) Web ETB hardcodes → org/lease currency. Gates green (typecheck+lint, 115 web tests). |
| 2026-10-08 #3 | Owner: continue from handoff — roadmap item 1, first slice | **Branch `feat/portal-payments` → PR #41 merged as `594b5ad` (15 files):** tenant portal payment flow. API: `POST /portal/payments/initiate` (pending Payment intent, supersedes prior pending, provider adapter call), `GET /portal/payments/:ref` (tenant-scoped), `POST /portal/payments/:ref/complete` (provider verify → Serializable tx: oldest-first allocations, negative ledger entry, receipt, audit; double-complete → 409); `ProviderNotConfiguredError` → 502. Shared: `mock` payment method + portal payment schemas (replaced unused `initiateOnlinePaymentSchema`). Web: Pay now button on portal due card + `/portal/pay/mock` simulated checkout page (fetches intent, confirms, shows receipt). i18n: 13 new keys ×4 catalogs. Gates green (lint+typecheck, 118 API + 118 web tests, web build incl. new route), CI verify ×2 green before squash-merge. Next: proof-of-payment upload + staff approval → PDFs → org gateway secrets. |
| 2026-10-08 #4 | Owner: continue from handoff — roadmap item 1, second slice | **Branch `feat/payment-proofs` → PR #42 merged as `7354ef2` (17 files):** proof-of-payment upload + staff approval. API: `PaymentProof` model (migration `20261008123702_payment_proofs`), portal upload/list/download endpoints, staff queue + approve/reject; `recordPayment` split into retry wrapper + exported `recordPaymentInTx` core so approval records the payment inside its own Serializable tx (no double-record, no approved-without-payment). Web: portal "Pay by transfer" card + staff review panel on Payments. Shared: `PAYMENT_PROOF_STATUSES`, `payment_proof` doc category, proof schemas. i18n: 18 keys ×4. ⚠ CI lesson: `next build` runs ESLint over test files with stricter rules than the local `eslint src` gate — an unused var in a test failed CI after local gates passed; run `pnpm --filter @pms/web build` from clean before pushing test files. Gates green (126 API + 120 web tests), CI ×2 green. Next: PDFs → org gateway secrets. |
| 2026-10-08 #5 | Owner: continue from handoff — roadmap item 1, third slice | **Branch `feat/receipt-pdf` → PR #43 merged as `d668b35` (12 files):** PDF receipts. **ADR-0028 written** (resolves the deferred font decision): pdfkit + Noto Sans Ethiopic static instances (Google Fonts cut, OFL 1.1, has Basic Latin + Ethiopic) bundled at `apps/api/assets/fonts/` and subset-embedded per PDF — mixed "አልማዝ በቀለ (Almaz Bekele)" renders in one typeface. `lib/pdf.ts` renderer, `services/receipts.ts` loader (staff `GET /payments/:id/receipt.pdf`, tenant `GET /portal/payments/:ref/receipt.pdf`, only `succeeded` payments). Web: Receipt PDF buttons on payments rows + mock checkout success. `docs/API.md` got a Tenant portal section; `THIRD_PARTY_NOTICES.md` covers pdfkit + fonts. Font lesson: the notofonts.github.io cut has NO Latin glyphs (tofu) — use the Google Fonts CSS API cut (static TTFs) for script+Noto pairs. Gates green (131 API + 120 web tests, clean web build), CI ×2 green. **Roadmap item 1 remaining: org gateway secrets** (per-org provider credentials, encrypted settings, org-aware adapter factory, Organization UI section) — recommended next slice; it touches secret handling and deserves a fresh session. |
