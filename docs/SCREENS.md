# Screens and navigation

The navigation groups work by **business area**, not by database table — the
convention that reads best in the references (MicroCommunity's sidebar groups
entities into modules; condo separates billing from operations from admin). Ours is
written for a landlord or a managing agent, in the order they think:

```
Sidebar
├── Overview
│   └── Dashboard
├── Portfolio
│   ├── Properties        (list → property detail → units)
│   ├── Units             (list, filters: property, status, type)
│   ├── Tenants           (list → tenant detail → ID documents, lease history)
│   └── Leases            (list → lease detail → charges, statement, documents)
├── Money
│   ├── Charges           (period picker → generate → per-lease charges, waive)
│   ├── Payments          (list, method/status filters → record, reverse, receipt)
│   └── Reports           (rent roll · arrears · occupancy · collections)
├── Operations
│   ├── Maintenance       (board by status → assign vendor, transitions, cost)
│   ├── Vendors           (list → detail: category, contact, jobs)
│   ├── Documents         (library, filters: entity, type, date)
│   └── Notifications     (outbox: recipient, channel, status, language)
└── Administration
    ├── Settings          (org profile, currency, calendar, language, defaults)
    ├── Members & roles   (invite, change role, deactivate)
    ├── ID types          (configurable local ID types)
    └── Translations      (Translation Manager: filters, history, import/export)
```

A user only sees the groups their role can read (the permission matrix decides, the
same table the API enforces).

## Screen inventory

| Screen                        | Purpose                    | Key interactions                                                                                                                 | Status                      |
| ----------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Dashboard                     | "Is anything wrong today?" | KPI cards (occupancy, expected, collected, arrears, open work orders), charts: collections trend, arrears by property, occupancy | Implemented                 |
| Properties                    | Portfolio register         | list + filters, create/edit, drill into units                                                                                    | Implemented                 |
| Property detail               | One building               | units table, occupancy, address block (region → kebele → house no. + landmark)                                                   | Implemented                 |
| Units                         | Rentable spaces            | list + filters (property, status), create/edit, market rent, status change                                                       | Implemented                 |
| Tenants                       | People who owe rent        | search, create/edit, ID documents (encrypted, last 4 visible), language per tenant                                               | Implemented                 |
| Tenant detail                 | One tenant                 | contact + emergency contact, ID types, lease history                                                                             | Implemented                 |
| Leases                        | The contract               | list + filters (status, property), create (unit + tenant + rent + billing calendar + due day + grace + deposit), edit, terminate | Implemented                 |
| Lease detail                  | One contract               | terms, co-tenants, charges by period, statement with running balance, documents                                                  | Implemented                 |
| Charges                       | What was billed            | period picker, generate for a period (created/skipped summary), filters, waive with reason                                       | Implemented                 |
| Payments                      | What came in               | record manual payment (cash/bank/cheque), allocate oldest-first, reverse with reason, receipt number                             | Implemented                 |
| Reports                       | Numbers for the owner      | tabs: rent roll, arrears aging, occupancy, collections; CSV export; calendar toggle                                              | Implemented                 |
| Maintenance                   | Repairs                    | board by status, priority, assign vendor, legal transitions, cost                                                                | Implemented                 |
| Vendors                       | Tradespeople               | list + category, contact details, job history                                                                                    | Implemented                 |
| Documents                     | Paperwork                  | upload (MIME + size checked), download through the API, delete (soft)                                                            | Implemented                 |
| Notifications                 | What was sent              | outbox with channel, language, status, template                                                                                  | Implemented (mock provider) |
| Settings                      | Organization               | profile, currency, default calendar + language, due day, late-fee switch                                                         | Implemented                 |
| Members & roles               | Who can do what            | invite, role change, deactivate                                                                                                  | Implemented                 |
| ID types                      | Local identity documents   | add/edit Kebele ID, national ID, passport, licence                                                                               | Implemented                 |
| Translations                  | Keeping 4 languages honest | per-key rows with English + current + source, filters (untranslated, machine draft, review status), history, CSV import/export   | Implemented                 |
| Login / register              | Getting in                 | email + password, organization creation on sign-up                                                                               | Implemented                 |
| Applications / questionnaires | Prospective tenants        | form builder, required documents, review status                                                                                  | v1                          |
| Renewal & rent review         | Keeping tenants            | milestones, propose increase, accept/decline                                                                                     | v1                          |
| Statements & invoices (PDF)   | Sending paperwork          | per-property owner statement, lease invoice                                                                                      | v1                          |
| Tenant portal                 | Tenant self-service        | balance, pay online, report a repair, upload documents                                                                           | later                       |
| Big-screen dashboard          | Office wall display        | occupancy + collections at a glance                                                                                              | later                       |

## UX rules that apply to every screen

- **Money** always through the shared formatter (ETB, santim, Geʽez numerals where
  the locale asks for them) — never `toFixed` in a component.
- **Dates** always through `@pms/calendar`, with the calendar (Ethiopian/Gregorian)
  taken from the user preference, and a dual-calendar hint on inputs.
- Loading, empty and error states are part of the screen, not an afterthought.
- Destructive actions (terminate lease, reverse payment) require a reason; financial
  records are corrected by reversal, never deleted.
- Long tables paginate; filters live in the URL so a screen can be shared.
- Responsive down to a phone-width column layout (the tenant-facing screens in v1
  are phone-first).
