# Item 3 (first PR) — task sidebar, property scope, global search

## Delivered

Sidebar now starts with a **Needs attention** panel: overdue charges, open work
orders, and leases in arrears, each with a live count and a deep link
(`/charges?status=overdue` opens the charges screen pre-filtered). Counts fetch
only when the role can read that data; the API remains the enforcement point.

Header gains a **global search** over properties, units and tenants using the
existing org-scoped list endpoints (no new API). Results are keyboard-navigable
(arrows, Enter, Escape) and use proper combobox/listbox semantics; picking a
tenant deep-links `/tenants?search=<name>`.

Header also gains a **property scope switcher** (All properties / one property).
It persists across reloads, scopes Units and Leases lists, and self-heals when a
stored property no longer exists. It is a display filter only — it cannot widen
or narrow what the role may read.

## Decisions

No new endpoints, dependencies, or storage; reuse report/list APIs. The property
scope lives in localStorage behind `useSyncExternalStore` with a custom event, so
no provider rewiring was needed. Search filters the already-loaded org lists
client-side after first focus; lists are org-scoped by the API. URL parameters
initialize filters once (`typeof window` guard keeps SSR safe) instead of adding
`useSearchParams` Suspense boundaries everywhere.

## Limits

Search does not open a dedicated detail screen yet (that is the unit-detail work
in the next PR); it navigates to the relevant list. The property scope applies to
Units and Leases only in this PR; Charges/Maintenance keep their own filters.
Non-English strings are machine drafts. No real Cloud Shell browser verification;
component tests only.

## Verification

94 web tests (task panel permissions and counts, search filtering/navigation/
empty state, switcher persistence, stale-property recovery, scoped unit list),
89 API tests, i18n/shared/calendar suites, worker-pool regression tests — all
green. Typecheck, lint, formatting and the critical audit gate checked separately.

## Next PR

Closable workspace tabs, unit detail screen and dashboard refinements.
