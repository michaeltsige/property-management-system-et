# Signup billing defaults — item 2 foundation

1. **Delivered:** signup API accepts account type, ETB-only currency and independent
   display/billing calendars, due day, grace days, late-fee rule and accepted payment
   methods. All settings are saved in the organization registration transaction.
   Existing registration clients retain conservative defaults. No new dependencies.
2. **Decisions:** fee percentage input is integer basis points; fixed fees are
   integer santim. A compatibility percent value is also stored for existing
   settings consumers. Due day is bounded 1–28, matching the existing lease input.
   These are configuration defaults, not an automatic charge or payment processor.
3. **Risks:** tax/late-fee enforceability needs local human verification. Accepting
   Telebirr/Chapa as preferences does not configure live gateways. This foundation
   does not yet provide the wizard UI, first-property step, or apply new defaults
   in the lease form. These remain in item 2 and are not claimed as completed.
4. **Tests:** 290 Vitest tests plus 4 worker tests pass; eight new API checks cover
   independent calendars, atomic invalid-input rejection, duplicate payment-method
   rejection, exact integer money validation, and legacy defaults. Typecheck/lint/
   formatting and critical audit are checked separately. No browser claim.
5. **Next:** wizard UI and skippable first-property/units step, followed by remaining
   tasks in DELIVERY_TRACKER.md. Owner has authorized continued work without asking
   for approval for each slice.
