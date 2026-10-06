# Item 1c — Bulk unit creation

1. **Delivered:** `POST /api/v1/units/bulk`, shared bounded naming preview and a
   Units-page modal. `{n}` is a literal placeholder (exactly once); start 0–999999,
   count 1–200, width 1–6. Units start vacant; optional building must be in property.
2. **Decisions:** one transaction, all-or-none, unique property-wide labels include
   soft-deleted reservations. Concurrent identical batches produce one success and
   one conflict, not duplicate units. API supports common unit attributes; UI
   intentionally starts with naming and hierarchy, not rent/lease setup.
3. **Risks:** no browser/Cloud Shell acceptance claimed. A retry after a lost success
   response returns 409: inspect the unit list rather than changing names blindly.
   Translations are unreviewed machine drafts. Storage and dependencies unchanged.
4. **Tests:** pattern bounds and invalid templates; optional block, cross-org/RBAC,
   duplicate rollback and concurrent requests; component preview/submission. Run
   `pnpm test`, then API/web typecheck and lint sequentially for low memory.
5. **Next:** validated CSV units and tenants in a separate PR with dry-run validation
   and a row error report. No later modules started.
