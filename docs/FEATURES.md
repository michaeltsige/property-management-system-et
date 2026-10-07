# Features

A complete, side-by-side description of everything the system does today, organized
by **who uses it** (owner/staff in the web app, tenants in the portal) and **how each
feature works**. For the screen inventory see `docs/SCREENS.md`; for the REST surface
see `docs/API.md`; for design rationale see `docs/DECISIONS.md`.

The system is built for Ethiopian property management: Ethiopian and Gregorian
calendars are first-class everywhere, money is handled in minor units (no floating
point), and every screen ships in English, Amharic, Afaan Oromoo and Tigrinya.

---

## 1. The two sides of the system

| Side | Who | How they sign in | What they see |
| --- | --- | --- | --- |
| **Staff app** (`/login`) | Owners and their staff | Email + password | The full management workspace: portfolio, money, operations, settings |
| **Tenant portal** (`/portal/login`) | Tenants | Phone + one-time SMS code (no password) | Only their own leases, balance, and maintenance requests |

The two sides share one API. Every request is scoped to exactly one organization:
a record from another organization is indistinguishable from a missing one (404,
never 403), so nothing leaks across landlords.

---

## 2. Roles and what each role can do

Roles are granted per organization. The same permission table drives the API (hard
enforcement) and the web UI (buttons hidden when you cannot act), so the interface
can never promise something the API would refuse.

### Owner / administrator (`owner_admin`)
Everything in the system, including the dangerous parts:

- Organization settings: currency, display calendar, **billing calendar**, language,
  rent due day, grace days, late-fee rules, reminder settings, ID-document retention.
- Invite and manage staff accounts and their roles.
- Full portfolio, leasing, money, operations, documents, notifications, translations
  and audit-log access.
- Billing management for the account itself.

### Property manager (`manager`)
Runs the day-to-day business:

- Properties, blocks, units (including bulk creation and per-type rent), tenants and
  their ID documents.
- Leases end-to-end (create, approve, terminate), charge generation and waivers,
  recording payments.
- Maintenance (assign vendors, close requests), vendors, documents, notifications.
- Reports and CSV exports, audit log.
- **Cannot**: change organization settings, manage users beyond inviting, refund or
  reverse payments, or manage billing.

### Accountant (`accountant`)
The money side, read-mostly on the portfolio:

- Record payments, view charges, full ledger access, reports and exports.
- Read properties, units, leases and maintenance for context.
- **Cannot**: edit the portfolio, create leases, waive charges, or see tenant ID
  document numbers.

### Maintenance staff (`maintenance`)
Work orders without the money:

- See and manage work orders, assign vendors, add notes, close requests.
- See properties and units (they need to know where to go).
- **Cannot**: see rents, charges, payments or any financial field — deliberately.

### Tenant (`tenant`)
Portal-only. Tenants never get a password; they sign in with a one-time code sent by
SMS to the phone number the landlord registered. The API additionally filters by
tenancy, so even a forged request could only ever return that tenant's own records.

---

## 3. Staff app, feature by feature

### Dashboard
- Period-aware snapshot: occupancy, units, active leases, open work orders, and the
  money summary (expected vs collected, collection rate, arrears) for the selected
  billing period, in the organization's calendar.
- Collection trend chart for the trailing months.
- Calendar switch lets any user view dates in Ethiopian or Gregorian regardless of
  what the organization defaults to; the data does not change, only the presentation.
- Property switcher narrows every screen to one property.

### Properties and the ownership hierarchy
- **Owners** (individuals or companies) hold properties; management fees per owner.
- **Properties** with Ethiopian address structure (region/city → sub-city → woreda →
  landmark), type (apartment block, villa, commercial…), and photo-less profile.
- **Blocks** group units inside a property (e.g. Building A/B); units, bulk batches
  and CSV imports can target a block.
- Portfolio mode: `self_owned` (one owner) or `managed` (multiple owners, per-owner
  statements later come from the ledger).

### Units
- Single unit creation with label, block, floor, bedrooms/bathrooms, area, status
  and market rent.
- **Bulk creation**: generate up to 200 units in one go from a naming pattern
  (`A-{n}`, start, count, zero-padding) with a live preview. The batch can carry an
  **apartment type** (e.g. `1BR`, `Studio`) and a market rent, so a whole floor of
  identical apartments lands fully configured in one submit.
- **Types and per-type rent**: units of the same type share a market rent. From the
  Units screen, *Set rent by type* reprices every unit of one type inside a property
  in a single audited action. Existing lease rents are never touched — only the
  unit's asking/market rent changes.
- Unit statuses: vacant / occupied / maintenance; occupied is driven automatically
  when a lease activates and freed when it ends.
- Unit detail page: the lease history, documents and work orders attached to the unit.
- CSV import for units, properties and tenants.

### Tenants
- Tenant records with phone, language preference and notes.
- **ID documents** (Kebele ID, passport, …): the number is encrypted at rest and only
  the last 4 digits are ever returned to clients; reading even those requires the
  `tenants.ids.read` permission. A retention period (org setting) governs cleanup.
- **Portal enrollment toggle**: staff can create or revoke a tenant's portal account
  from the Tenants screen. Enrollment is idempotent and provisions an OTP-only
  account linked to the tenant's phone number.
- Co-tenants are attached to leases, not standalone accounts.

### Leases
- Lease terms: rent, currency, billing frequency (monthly/quarterly), due day of the
  billing month, grace days, late-fee percent/fixed, deposit (months-of-rent or fixed
  amount), escalation percent and interval, signed-at date, notes.
- **Billing calendar is an organization-level owner decision** (Settings → Billing
  calendar). Every new lease inherits it; periods and due dates are then generated in
  that calendar. The lease form shows the inherited calendar read-only.
- Lifecycle: `draft → pending → active → expired/terminated` with overlap protection
  (a unit cannot have two active/pending leases).
- **Pro-rated first period** when the lease starts mid-period; deposits are held on
  the ledger, not in a text field.
- Termination records the reason and refunds deposits as ledger entries — money
  moving back to a tenant belongs in the books.
- Lease detail page: balance, statement lines, charges for the last periods, and the
  unit/tenant context.

### Charges (rent billing)
- Period-based rent charges generated per billing period (12×30 days + Pagume for the
  Ethiopian calendar), idempotently: regenerating a period never duplicates a charge
  (unique constraint + worker-side checks).
- Generation can be targeted at specific leases and periods from the Charges screen.
- Waivers (with reason and approval permission) write off charges instead of
  deleting them.
- An overdue sweep job marks overdue charges and (with reminders enabled) queues
  reminder notifications.

### Payments
- Record payments by method (cash, bank transfer, telebirr, Chapa, …) with reference
  and notes; amounts are allocated **oldest-charge-first** with partial allocations.
- Overpayments become tenant credit on the ledger.
- **Receipts** are generated per payment; **statements** per lease.
- Mistakes are corrected by **reversal, never deletion** — the ledger keeps the full
  history. Refunds and reversals are separate, higher-level permissions.
- Reconciliation view and payment export for accountants.

### Ledger and reports
- Double-entry style ledger: every charge, payment, waiver, deposit and adjustment is
  a dated entry; nothing financial exists outside it.
- Reports: rent roll, arrears/aging, collection summary, per-period comparisons — in
  the organization calendar, exportable to CSV.

### Maintenance
- **Tenant-initiated, staff-managed**: tenants file requests from the portal; staff
  see who reported each request on the Maintenance board.
- Ticket numbers (`WO-YYYY-NNNNNN`), category, priority (low → urgent), status
  machine `open → assigned → in_progress → completed/cancelled` enforced by the API —
  the UI only offers legal moves.
- **Note threads** on every request: staff notes can be flagged **internal**
  (staff-only) or visible to the tenant. Everything the tenant sees on their request
  was meant for them.
- **Closing requires a note**: completing or cancelling a request demands a closing
  note describing the outcome; it becomes a tenant-visible note automatically.
- Vendors (plumbers, electricians, …) with category and contact details; assigning a
  vendor is required before work can start.

### Documents
- Uploads (PDF/images) linked to a property, unit, lease or tenant — uploads are
  validated against the organization's own records, size-limited, and stored through
  a storage abstraction (local disk today, S3 planned).

### Notifications
- In-app and SMS notifications from templates (invitations, reminders, …) with
  variable substitution; SMS goes through a provider abstraction (a mock provider in
  development prints the message body in the worker log; production never does).

### Settings and administration
- Organization defaults: currency, display calendar, **billing calendar**, default
  language, rent due day, grace days, late-fee rules, reminders, ID retention — every
  change is audited.
- Staff invitations with role selection; membership status controls (activate/deactivate).
- **Translation overrides**: any UI string can be overridden per language for this
  organization (e.g. house-grown terminology) without touching code.
- **Audit log**: every create/update/delete records actor, before/after snapshots and
  request ID — the answer to "who changed what, when".
- Workspace tabs keep screens open as you navigate (append-only, never reordered);
  global search jumps to any property, unit, tenant or lease.

---

## 4. Tenant portal, feature by feature

### Sign-in without passwords
- The tenant enters the phone number the landlord registered; a 6-digit code is sent
  by SMS. Unknown and known numbers answer identically (no account discovery).
- Codes expire in 10 minutes, are single-use, and lock after five wrong attempts.
- Sessions are tenant-scoped: the token only ever unlocks that tenant's own data.

### Home
- **Amount due** right now (pending + overdue charges), or an "up to date" badge.
- **My leases**: unit, property, rent, start date and status for each lease.

### Maintenance requests
- File a request (title + description) against the tenant's active lease — it lands
  on the staff Maintenance board with the tenant's name and unit attached.
- Follow the request's status and read staff replies (internal staff notes are never
  exposed). The closing note the staff writes on completion appears here.
- Tenants without an active lease are told to contact their landlord.

---

## 5. Cross-cutting behavior

- **Calendars**: Ethiopian (13 months, 12×30 + Pagume) and Gregorian are both
  first-class. Billing periods, due dates, dashboards and date pickers all compute in
  the correct calendar; every date can also be shown dual-calendar.
- **Languages**: English, Amharic, Afaan Oromoo, Tigrinya — complete catalogs with
  CI enforcement; each user picks their own language, organizations pick a default,
  and per-organization overrides are possible. Amharic month names render in
  Ethiopic script (መስከረም … ጳጉሜን).
- **Money**: minor units end-to-end (BigInt on the server, decimal strings over the
  wire), no float arithmetic, currency per organization.
- **Security posture**: HttpOnly cookies in the browser (no tokens in JavaScript),
  short-lived access tokens with server-side refresh, rate-limited auth, encryption
  at rest for ID numbers, audit trail on every mutation.
- **Offline-friendly PWA**: the app shell is installable; background data refresh is
  deliberately conservative to avoid stale-money bugs.

---

## 6. Planned next (roadmap excerpt)

- Mock payment completion + proof-of-payment upload with staff approval, organization
  gateway secrets (see `docs/ROADMAP.md`).
- PDF generation for receipts/statements.
- Contextual documents/checklists with expiry reminders (e.g. insurance, inspection
  certificates).
- Consent flows, self-hosted fonts, richer demo seed.
- Playwright end-to-end suite running in CI only.
