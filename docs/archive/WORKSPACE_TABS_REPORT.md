# Item 3 (second PR) — closable tabs, unit detail, dashboard polish

## Delivered

**Workspace tabs.** Visiting a workspace screen opens a tab above the content;
tabs persist across reloads, reorder by recency, cap at 8, and close with one
click. Closing the active tab navigates to the nearest remaining tab (or the
dashboard). Tab state is presentation-only localStorage — closing a tab never
touches data.

**Unit detail.** Each unit label in Units now links to `/units/<id>`: status,
market rent, bedrooms and area cards, the unit's leases (tenant, rent, start,
status) and its maintenance history. Built entirely from existing org-scoped
endpoints; unknown units and missing permission get honest states.

**Dashboard polish.** A Vacant-unions stat card joins the second row, linking
to Units and flagging positive vacancy in warning tone.

## Decisions

No new API routes or dependencies. The unit screen composes the existing list
endpoints client-side (documented limit: with very large portfolios a dedicated
unit endpoint would serve better; pagination is a later phase). `useSyncExternalStore`
snapshots are identity-cached to avoid rerender loops. Tabs recognize the static
nav routes plus `/units/<id>` only; auth/onboarding routes are not tabbed.

## Limits and honesty

Work-order lists are fetched page-sized (100) and filtered locally; a unit with
more than 100 org-wide orders could miss older entries. Non-English labels are
machine drafts. This is component-level verification, not real Cloud Shell
browser acceptance.

## Verification

102 web tests (tab store bounds/dedupe/close-neighbour, route recognition,
active-tab marking, unit detail facts/lease/maintenance/unknown/permission,
dashboard vacancy), plus the full suite: 89 API tests, i18n/shared/calendar,
worker-pool regression. Lint, formatting, typecheck and production web build
pass; critical audit gate unchanged.
