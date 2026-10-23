# Item 1b — Owner/block UI and signup mode

## 1. Delivered

Signup mode selector: “I own these properties” (default) or “I manage properties
for other owners”. Properties hides the landlord level for self-owned accounts;
managed accounts can add/edit landlords, contacts and optional percentage fees,
and choose the landlord when creating a property. A property-specific dialog adds
or renames blocks. Unit creation offers only that property's blocks; changing the
property clears the block. Property and unit lists display hierarchy context.

## 2. Decisions

ADR-0029. Existing controls and API, shared role permissions, no new dependencies
or storage changes. Decimal fee text converts exactly to integer basis points.
Owners without login accounts remain separate from users. No runtime modules added.

## 3. Risks / limits

This is not the full signup wizard or redesign. Existing property reassignment,
existing unit block reassignment, and post-signup mode changes have no UI yet.
Non-English additions are unreviewed machine drafts, not verified translations.
No real-browser or Cloud Shell acceptance claimed for this slice; component tests
use jsdom with mocked API calls. Existing moderate/high tooling advisories remain;
the critical test-pool findings were fixed separately in PR #10.

## 4. Verification

Local: 250 Vitest tests plus 4 lightweight Node worker tests passed. Web typecheck,
full lint, formatting and production web build pass. Nine new tests cover exact fee
parsing, create/edit/error retention, block create/rename, self-owned hiding, managed
owner selection, accountant write restrictions, stale block reset, and signup mode.
Build ran alone with a 1400 MB Node heap cap; no dev/preview servers were started.

Manual check after deployment:

1. Register self-owned; Properties has no landlord section or owner selector.
2. Register managed; add a landlord with a 7.50% fee; reload and verify it persists.
3. Create their property; add/rename a block; create a unit in it.
4. Change the selected property in the unit form; the previous block must disappear.
5. Use an accountant account: hierarchy data is readable, write controls unavailable.
6. Exercise errors (duplicate block, invalid phone); input stays available to correct.

Run `pnpm test`, `pnpm exec turbo run typecheck --filter=@pms/web`, and
`NODE_OPTIONS=--max-old-space-size=1400 pnpm exec turbo run build --filter=@pms/web`.

## 5. Next

Bulk unit creation with a naming pattern, then validated CSV unit/tenant imports
and row-level error reports, each as a separate small PR. The full onboarding
wizard and later modules remain in the requested order.
