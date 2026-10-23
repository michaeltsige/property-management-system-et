# Startup freshness and calendar-switch regression fix

## Findings

The supplied Cloud Shell log shows the API loading compiled @pms/shared without
createBuildingSchema. dev:all skipped the build whenever dist/index.js existed,
without checking whether source had changed after a pull. This is a definite
bootstrap defect, not a database/migration or missing-package-install problem.

Dashboard and Reports separately retained period keys across calendar changes.
Ethiopian month 13 is invalid when reinterpreted as Gregorian. Old collections
also remained in useAsync data during refetch and were formatted under the new
calendar. These are reproduced code defects; the user's original browser exception
was not supplied, so the exact Cloud Shell calendar failure remains unconfirmed.

## Changes

- Always invoke Turbo's source-aware package build, sequentially before apps.
  Unchanged source can use cache; dist existence is only a post-build sanity check.
- Wait for API health before starting worker/web. A failed API no longer boots the
  remaining services, though tsx watch can keep its wrapper alive until timeout.
- Calendar-owned period selections in Dashboard/Reports; a calendar's first use
  selects its current month, switching back restores that calendar's selection.
- Collections responses carry their request calendar; stale-calendar rows are
  withheld while refetching. No money/date conversions or database data changed.

## Verification

Three Node bootstrap tests cover existing output, failed builds and missing output.
A real source-change experiment with pre-existing dist confirms the new export is
rebuilt and importable; temporary source changes were restored. Web tests include
Pagume -> Gregorian -> Ethiopian -> Gregorian switching and invalid-month regression.
Web typecheck and full lint passed. No Cloud Shell proxy/browser validation claimed.
No new dependencies, background processes, migrations or destructive cleanup.

## Recovery and manual check

Stop dev:all, then:

```sh
pnpm exec turbo run build --filter='./packages/*' --force --concurrency=1
pnpm dev:all
```

After updating to this fix, ordinary dev:all runs check freshness automatically.
Do not reset Postgres, delete volumes, or force reseed for this issue.
Use `nvm install && nvm use` for the project's .nvmrc Node 20 baseline; the supplied
log uses Node 24, but the missing export is explained by stale output, not proven
to be Node-version-specific. Check Dashboard and Reports in both calendars,
including Pagume, then restart and repeat. If errors remain, capture the browser
console exception and failing Network request. Keep the UI redesign paused until
this regression is addressed.
