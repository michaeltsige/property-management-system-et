# Phase 3 — Web UI: phase report

**Status:** complete, awaiting your acceptance. Branch `feat/phase-3-web-ui`, PR #6.
**Date:** 2026-10-05. **Approved to start:** yes ("I approve and I'm giving you the go ahead").

Phase 3 asked for: a shell and dashboard with ECharts, a screen for every entity,
auth flows with states/filters/pagination/forms, PWA basics, accessibility — accepted
when _a non-technical user completes lease → payment on a laptop and at phone width_.

The screens all existed from Phase 1. The audit for this phase found that the
acceptance criterion was **not** met: below `lg` the sidebar was `hidden`, so a phone
user could see the dashboard and could not reach a single other screen. That, the
PWA, the accessibility pass and the findings below are this phase.

---

## 1. What was done

### Navigation and layout

- **Phone navigation (ADR-0023).** Below `lg` the full navigation lives in a Radix
  dialog drawer with the same links, `aria-current` on the active page, the
  language/calendar switchers and sign-out. Nine screens that were unreachable on a
  phone now are not.
- **Skip link** to `#main`, a focusable `<main>`, and a global `:focus-visible` ring.
- **Document titles** per screen (`useDocumentTitle`), so the tab, the history entry
  and the screen-reader announcement all name the page.
- **`prefers-reduced-motion`** honoured.

### Dashboard

- **Quick actions** — new lease, record payment, new tenant, add property — which open
  the target screen with its create dialog already open (`?new=1`, cleaned from the
  URL immediately so a refresh does not reopen it).
- **Empty-portfolio onboarding**: a new organization gets one clear next step instead
  of a wall of zeros.
- **"Rent due" can no longer be negative.** It showed `Br -103,500.00` after a large
  payment; an over-collected period is real, but a negative amount due is not, and the
  arrears card carries the balance picture.

### Accessibility (ADR-0024)

- **Charts are readable.** Every ECharts canvas is `role="img"` with a label and
  renders the same data as a visually hidden table — the text equivalent for screen
  readers, and the fallback when a canvas cannot draw.
- **Contrast fixed against measurements**, not taste: gold text `#a97710` → `#8a5f0c`
  (3.5:1 → 5.0:1 on the gold tint), white-on-gold button → `#8a5f0c` (2.5:1 → 5.6:1),
  placeholders `slate-400` → `slate-500`, translator status text `slate-400` →
  `slate-500`.
- **Names for controls**: every filter `<select>` (charges, maintenance, payments,
  translations), the translation search box and all 227 per-key translation inputs,
  and every icon-only button. `MoneyInput` gained a real `<label for>`.
- **Structure**: `scope="col"` on table headers, `role="alert"` for failures and
  `role="status"` for confirmations, `aria-hidden` skeletons.

### PWA

- `manifest.webmanifest` with name, theme colour, 192/512/maskable icons, two
  shortcuts (record payment, new lease) and `start_url: /dashboard`.
- A generated icon set (192, 512, maskable, apple-touch), and a `src/app/icon.png`
  favicon.
- `public/sw.js`: precaches the offline page **and the build chunks it references**,
  cache-first for immutable build assets and icons, network-first for navigations,
  and **never caches `/api/*`**. `/sw.js` is served with `no-store`.
- `/offline` — a real screen in the user's language with one action: try again.

### Fixed because the browser found them (ADR-0025)

| #   | Defect                                                               | Effect                                                                                          |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Members API returns flat rows; the web type declared a nested `user` | `/settings` crashed to "Application error" for every user                                       |
| 2   | Login response had no top-level `role`                               | Every page header and drawer read `role.undefined`                                              |
| 3   | Next blocks `/_next/*` from an unrecognised origin                   | Visiting via `127.0.0.1` gave a page that never hydrated; the form fell back to a native submit |
| 4   | `MoneyInput` label had no `for`/`id`                                 | Amount fields had no accessible name, and clicking the label did nothing                        |
| 5   | Gold accent below WCAG AA                                            | axe-core, 3 screens, 7 nodes                                                                    |

Also fixed while in these files: the lease form's frequency select was labelled "Amount"
and listed raw `semi_annual`; the payment screen's status badge printed `succeeded`,
its date field was labelled "Period" and its reference field "Receipt number"; the
reversal and termination dialogs had body copy hardcoded in English; `?new=1` deep
links now work on properties, units, tenants, leases and payments equally.

## 2. Decisions and assumptions

- **ADR-0023** phone navigation is a drawer + an offline _shell_, not an offline
  _product_: nothing is queued, nothing is replayed, and money is never stale.
- **ADR-0024** accessibility rules are machine-checked where they can be (component
  tests) and audited in a browser where they cannot (axe-core over 12 screens).
- **ADR-0025** the browser walkthrough is part of the phase, and its evidence is
  committed: `docs/screenshots/phase-3/` (6 screenshots + `verification-report.json`).
- **Assumption:** "PWA basics" means installable + offline shell + manifest, not
  background sync, push notifications or a cached app shell. Background sync would
  need server-side idempotency keys, which is Phase 5 work.
- **Assumption:** the walkthrough's non-technical user is represented by an automated
  script driving the real UI. No human who has never seen the product has used it yet —
  see the open issues.
- Charts label overlap: 13 Ethiopian months do not fit across a phone, so ECharts
  hides overlapping labels rather than drawing them on top of each other.
- No route-based code splitting was added. `/dashboard` and `/reports` ship ~554 kB
  first-load because of ECharts; the 13 data screens are 180 kB. This is noted, not
  hidden, in the open issues.

## 3. Risks and human verification

- **Human accessibility review.** axe-core catches roughly a third of real problems.
  Nothing here has been used with a screen reader by a person who relies on one, nor
  tested with keyboard-only navigation end to end by a human. Listed as an open issue.
- **Non-technical-user usability.** The acceptance criterion is behavioural, and it is
  demonstrated by a script that knows what to click. A first-time human should still
  do the walkthrough before this is called validated.
- **Translations remain machine drafts.** The Amharic/Afaan Oromo/Tigrigna entries added
  this phase (`nav.menu`, `a11y.*`, `billing.*`, `payment.status.*`, `offline.*`, 30
  keys) are drafts like the rest, and are marked `machine_draft` in the Translation
  Manager. The open question from Phase 0 still stands: who reviews them?
- **Not verified in this environment:** the PWA install prompt on a real device, the
  service worker behind a CDN with its own cache headers, and iOS Safari's offline
  behaviour. The checks here ran in headless Chromium on localhost.
- **`apps/mobile`** remains untouched, per the plan.

## 4. How to run and test

```bash
git fetch origin && git checkout feat/phase-3-web-ui && git pull
pnpm install

# full local stack (Postgres via docker-compose, migrations, demo seed, api + web)
pnpm dev:all          # http://localhost:3000, owner@demo.test / DemoPass123
```

| What                                                                 | Command                                             |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| All tests (184 now: calendar 59, shared 33, i18n 16, web 20, api 56) | `pnpm test`                                         |
| Web component/a11y tests only                                        | `pnpm --filter @pms/web test`                       |
| Types and lint                                                       | `pnpm typecheck && pnpm lint`                       |
| Formatting                                                           | `pnpm format:check`                                 |
| Production build                                                     | `pnpm --filter @pms/web build`                      |
| The committed acceptance evidence                                    | `docs/screenshots/phase-3/verification-report.json` |

**Manually check the two acceptance paths** (this is what the report's walkthrough did):

1. **Laptop:** sign in → Dashboard → _New lease_ quick action → create a lease → _Record
   payment_ → pick the lease → save → a green "Payment recorded · receipt N" banner.
2. **Phone width (≤ 1024 px):** the same flow through the ☰ drawer. The unit list is
   filtered to vacant units; create a property and a unit first if the demo has none.

To re-run the browser audit (needs a browser; kept outside the repo):
`node /home/user/_e2e/verify.mjs` with `AUDIT_PAGES=…` against `http://localhost:3000`.

## 5. Proposed next steps

Phase 4 per the roadmap: **localization and calendars** — finish `en`, mark `am/om/ti`
with reviewer status, DB overrides + Translation Manager polish, the Pagume/leap/year
-boundary test matrix extended, the 13-month picker wired into charge generation, and a
CI check for missing English keys.

Suggested priorities inside it, given what this phase found:

1. A missing-key check that **fails CI** (today the lint runs inside a test; the roadmap
   wants an explicit gate).
2. A native-reviewer workflow for the catalogs, including a `reviewed` transition with
   an audit entry — the answer to the Phase 0 question about who signs off.
3. Amharic-first screenshots of the phone walkthrough, since the drawer and the payment
   flow are the most language-sensitive parts of the product.

I will not start Phase 4 until you say so.
