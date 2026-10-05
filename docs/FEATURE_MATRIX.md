# Feature matrix

Columns 1-5 are the references studied in Phase 0; the last three columns are **our**
scope decision for each feature. "MVP" = already implemented and demoable (phase 1-2
of this build). "v1" = next, required for a real landlord to run their business on
it. "later" = deliberately out of scope for now.

Legend: ● present · ◐ partial · ○ absent · — not applicable

| Feature                                                      | OpenProperty (upstream)             | OpenProperty (GSLabIt)    | open-condo        | MicroCommunity | Pronto (concepts) | **MVP**                           | **v1**                     | **later**      |
| ------------------------------------------------------------ | ----------------------------------- | ------------------------- | ----------------- | -------------- | ----------------- | --------------------------------- | -------------------------- | -------------- |
| Properties + units                                           | ●                                   | ●                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Ethiopian address structure                                  | ○                                   | ○                         | ○                 | ○              | ○                 | ●                                 |                            |                |
| Tenants + ID documents                                       | ◐                                   | ◐                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Lease terms (rent, deposit, due day, grace)                  | ◐                                   | ◐                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Lease status lifecycle                                       | ◐ (upcoming/active/ended/cancelled) | ◐                         | ●                 | ●              | ●                 | ● (draft→active→ended/terminated) |                            |                |
| Co-tenants                                                   | ●                                   | ●                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| **Billing calendar per lease (Ethiopian/Gregorian)**         | ○                                   | ○                         | ○                 | ○              | ○                 | ●                                 |                            |                |
| Rent charges per period                                      | ●                                   | ●                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Idempotent charge generation                                 | ● (unique index)                    | ●                         | ●                 | ●              | ●                 | ● (unique + worker)               |                            |                |
| Pro-rated first period                                       | ○                                   | ○                         | ◐                 | ◐              | ●                 | ●                                 |                            |                |
| Deposits tracked on the ledger                               | ○                                   | ○                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Payments allocated to charges                                | ● (1:1 to charge)                   | ●                         | ●                 | ●              | ●                 | ● (oldest-first, partial)         |                            |                |
| Overpayment as credit                                        | ○                                   | ○                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Reversal instead of delete                                   | ○ (hard delete)                     | ○                         | ●                 | ◐              | ●                 | ●                                 |                            |                |
| Arrears / aging query                                        | ○                                   | ○                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Late fees                                                    | field only                          | field only                | ●                 | ●              | ●                 |                                   | ●                          |                |
| Grace period before late fee                                 | ○                                   | ○                         | ●                 | ●              | ●                 | ● (on lease)                      |                            |                |
| Receipts                                                     | ○                                   | ○                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Statements (per lease)                                       | ○                                   | ○                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Invoices / PDF                                               | ○                                   | ○                         | ●                 | ●              | ●                 |                                   | ●                          |                |
| Online payments (provider)                                   | ○                                   | ○                         | ●                 | ●              | ●                 | ◐ (interface + mock)              | ● (Telebirr/Chapa live)    |                |
| Webhooks with replay protection                              | ○                                   | ○                         | ●                 | ●              | ●                 |                                   | ●                          |                |
| Reconciliation job                                           | ○                                   | ○                         | ●                 | ●              | ●                 |                                   | ●                          |                |
| Manual payment (cash/transfer)                               | ●                                   | ●                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Maintenance work orders                                      | ●                                   | ●                         | ● (tickets)       | ●              | ●                 | ●                                 |                            |                |
| Vendor management                                            | ●                                   | ●                         | ●                 | ●              | ●                 | ●                                 |                            |                |
| Work-order transitions                                       | ● (free status)                     | ●                         | ● (state machine) | ●              | ●                 | ● (enforced state machine)        |                            |                |
| Documents / attachments                                      | ○                                   | ○                         | ●                 | ●              | ●                 | ● (private, checksummed)          | ● (e-sign acknowledgement) |                |
| Notifications (SMS/email)                                    | ○                                   | ○                         | ●                 | ●              | ●                 | ◐ (mock provider + templates)     | ● (local SMS provider)     |                |
| Notification policies (reminders, escalation)                | ○                                   | ○                         | ●                 | ●              | ●                 |                                   | ●                          |                |
| Reports: rent roll, arrears, occupancy, collections          | ○                                   | ○                         | ●                 | ●              | ●                 | ● (+ CSV)                         |                            |                |
| Reports: income by property, maintenance cost                | ○                                   | ○                         | ●                 | ●              | ●                 |                                   | ● (+ PDF)                  |                |
| Owner statements / disbursements                             | ○                                   | ○                         | ●                 | ●              | ●                 |                                   | ●                          |                |
| Applications / questionnaires                                | ◐ (manual records)                  | ◐                         | ● (surveys)       | ●              | ●                 |                                   | ● (form builder)           |                |
| Renewals + rent review workflow                              | ○                                   | ○                         | ●                 | ●              | ●                 |                                   | ●                          |                |
| Multi-organization (SaaS)                                    | ○ (single)                          | ○ (single)                | ●                 | ●              | ●                 | ●                                 |                            |                |
| RBAC (owner/admin, manager, accountant, maintenance, tenant) | ○ (none)                            | ○ (none)                  | ●                 | ●              | ●                 | ●                                 |                            |                |
| Audit log for financial/lease records                        | ○                                   | ○                         | ◐                 | ◐              | ●                 | ●                                 |                            |                |
| Cross-org isolation tests                                    | —                                   | —                         | —                 | —              | —                 | ●                                 |                            |                |
| i18n with stable keys                                        | ○                                   | ◐ (English-sentence keys) | ●                 | ◐              | ●                 | ● (en, am/om/ti drafts)           | ● (native review)          |                |
| Translation Manager (DB overrides, CSV)                      | ○                                   | ○                         | ◐                 | ○              | ●                 | ●                                 |                            |                |
| Ethiopian calendar conversion + picker                       | ○                                   | ○                         | ○                 | ○              | ○                 | ●                                 |                            |                |
| Geʽez numerals, ETB formatting                               | ○                                   | ○                         | ○                 | ○              | ○                 | ●                                 |                            |                |
| Configurable tax rules (verified flag)                       | ○                                   | ● (Italy: ISTAT/IMU)      | ◐                 | ◐              | ●                 | ● (unverified ET defaults)        | ● (accountant-verified)    |                |
| PWA / installable, offline fallback                          | ○                                   | ○                         | ○                 | ● (app)        | ●                 |                                   | ●                          |                |
| Tenant portal / mobile app                                   | ○                                   | ○                         | ●                 | ●              | ●                 |                                   |                            | ●              |
| Big-screen dashboard                                         | ○                                   | ○                         | ○                 | ●              | ●                 |                                   |                            | ●              |
| Inspections, parking, gates, procurement                     | ○                                   | ○                         | ◐                 | ●              | ◐                 |                                   |                            | ●              |
| Bank/mobile-money auto-reconciliation                        | ○                                   | ○                         | ●                 | ◐              | ●                 |                                   | ◐                          | ● (bank feeds) |
| Multi-currency                                               | ○                                   | ○                         | ●                 | ●              | ●                 |                                   |                            | ●              |

## Reading the matrix

- **No reference is close on Ethiopian requirements.** Calendar-per-lease, ETB
  integer money, Geʽez formatting and configurable unverified tax rules have no
  counterpart anywhere in the five projects — that is the product's reason to exist,
  and it is covered by our own tests.
- **Two references have no authentication at all** (both OpenProperty forks), which
  is why we treat them as a domain-model sketch and nothing more.
- **condo is the only reference with a comparable domain depth**, and it is the source
  of our connector/interface thinking, not of any code.
- **MicroCommunity contributes breadth** (the v1/later rows: questionnaires,
  inspections, e-signature, big-screen dashboards) and the navigation grouping.
- **Late fees are the notable MVP gap.** Reference implementations store the field and
  never apply it; we store grace period + rule fields and apply them in v1 with a
  configurable rule (and a human-verified value).
