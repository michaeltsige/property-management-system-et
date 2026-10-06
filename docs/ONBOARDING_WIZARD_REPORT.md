# Item 2 — Signup wizard and first-property setup

1. **Delivered:** profile → billing → review signup flow, account type separate
   from ownership mode, required phone, language/display calendar, independent
   billing calendar, due/grace days, late-fee configuration, payment methods and
   ETB. After signup, optionally create the first apartment property and 0–200
   vacant units, or skip. Managed mode requires a landlord name. Dashboard links
   back to unfinished setup. Repeated/concurrent setup completion is safe.
2. **Decisions:** ADR-0033. Same REST API and cookie session, existing shared
   validation/naming, no new dependencies/storage changes. Defaults fill the lease
   form's billing calendar and due day; grace and percentage configuration are
   submitted on new leases. Display calendar does not drive these defaults.
3. **Limits:** fixed-fee policy is stored, not automatically charged (jobs/payment
   work remains later). Setup creates an apartment property; advanced address/type
   edits use the existing API, not a new editor here. Language additions are machine
   drafts needing review. No real-browser/Cloud Shell acceptance claimed.
4. **Tests:** 297 Vitest tests + 4 worker tests passed; API/web typechecks, full lint,
   formatting and production build checked separately. Tests include wizard
   navigation/payment-method validation, skip UI, API atomicity, concurrent replay,
   managed owner requirements, invalid inputs and role/pending-state enforcement.
5. **Next:** task-based navigation and closable workspace tabs, property context,
   global search, dashboard/unit details, followed by tenant portal and remaining
   tasks. Standing approval permits continuing without per-PR confirmation.

Manual check: register in each ownership mode, select a billing calendar different
from display, review settings, create a property/units or skip, reload and verify
setup cannot create duplicates. Open a new lease and verify its billing defaults.
