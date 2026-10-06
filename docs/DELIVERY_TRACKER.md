# Consolidated delivery tracker

The owner authorized proceeding through all remaining numbered items on 2026-10-06,
without per-slice approval. Continue separate small PRs, tests/docs/reports, and
merge only with green checks. Update the owner in consolidated batches. Stop for
credentials/access, licence uncertainty, destructive actions or stack changes.

| Item                                                                             | State                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Owner hierarchy, UI, bulk units, CSV                                          | Merged, PRs #9–13                                                       |
| 2. Owner/admin onboarding wizard                                                 | Defaults merged (#14); wizard and atomic first-property setup in review |
| 3. Task sidebar, property switcher/search, dashboard, unit detail, closable tabs | Not started                                                             |
| 4. Tenant OTP portal, enrollment/review, private IDs, PWA                        | Not started                                                             |
| 5. Mock payment completion, proof approval, PDFs, org gateway secrets            | Not started                                                             |
| 6. Contextual documents, checklists, expiry reminders                            | Not started                                                             |
| 7. Consent, self-hosted font, realistic seed                                     | Not started                                                             |
| 8. CI-only Playwright, excluded from pnpm test and Cloud Shell startup           | Not started                                                             |

Constraints retained: local storage behind existing interface; no heavy new
runtime dependencies; sequential memory-heavy gates; official Telebirr/Chapa
adapters unchanged without supplied docs and sandbox credentials. Reference UI is
inspiration only, no copied assets/code/layout. Optional module hiding must not
replace API authorization or delete data. Real Cloud Shell browser acceptance is
still outstanding; sandbox component/integration tests are not that evidence.
