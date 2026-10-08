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

- **Last verified:** 2026-10-08, `main` = `ab6bff7`
- **Open PRs:** none
- **Latest merges:** #38 UI polish (flat cards, stronger titles) · #37 Organization section (profile/team/translations, audited `PATCH /organizations/profile`) · #36 UX fixes (no staff-created maintenance requests, single-language region options, floor label) · #35 brand (real Addis Ababa photo login hero CC BY-SA 4.0, vector SVG logo) · #34 FEATURES.md
- **Resolved owner questions:** tenant-portal login works only for enrolled tenants; demo seed = Almaz Bekele `+251911000001` (dial `0911000001`), OTP prints in worker log (mock SMS).

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
| 2026-10-08 | Owner: add this handoff doc and keep it updated after every prompt/action | Created `docs/AGENT_HANDOFF.md`; merged to `main` |
