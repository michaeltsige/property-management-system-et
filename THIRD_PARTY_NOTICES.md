# Third-party notices

This project is an original implementation. Reference projects were studied for
**ideas**, not copied: no source file, asset, icon, stylesheet or text from any
reference project was copied into this repository. `docs/REFERENCES.md` records,
per reference, what was consulted, its license, and what was deliberately rejected.

## Reference projects (studied, no code copied)

| Project                                                                      | License    | What was taken                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [clawnify/OpenProperty](https://github.com/clawnify/OpenProperty) (upstream) | MIT        | Lease-centric domain model and the "country-localization file" pattern.                                                                                                                                                      |
| [GSLabIt/OpenProperty](https://github.com/GSLabIt/OpenProperty)              | MIT        | Domain table shapes (rent charges, payments, work orders) and the idea of keeping country-specific rules in one module.                                                                                                      |
| [open-condo-software/condo](https://github.com/open-condo-software/condo)    | MIT        | Ticket/maintenance flow, billing connector interface, multi-org access control, notification templates, translation linting, `AGENTS.md` conventions. Its stack (KeystoneJS 5, Apollo, Django migrator) was **not** adopted. |
| [java110/MicroCommunity](https://github.com/java110/MicroCommunity)          | Apache-2.0 | Feature checklist, reporting catalogues, menu/permission grouping. No Java code copied.                                                                                                                                      |
| [java110/MicroCommunityWeb](https://github.com/java110/MicroCommunityWeb)    | Apache-2.0 | Navigation/information architecture only; the UI was recreated in React + Tailwind.                                                                                                                                          |

Pronto Housing was used for **concepts only** (proprietary; no code, text, UI,
branding or assets were copied).

## npm dependencies

All runtime dependencies are consumed as published packages under their own
licenses (MIT/Apache-2.0/ISC). Notable ones:

| Package                                                            | License          | Use                                                           |
| ------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------- |
| `next`, `react`, `react-dom`                                       | MIT              | Web application framework.                                    |
| `tailwindcss`                                                      | MIT              | Styling.                                                      |
| `@radix-ui/*`                                                      | MIT              | Accessible primitives behind the shadcn-style components.     |
| `class-variance-authority`, `clsx`, `tailwind-merge`               | MIT              | Component variants and class merging (shadcn/ui conventions). |
| `lucide-react`                                                     | ISC              | Icons.                                                        |
| `echarts`                                                          | Apache-2.0       | Dashboards and reports.                                       |
| `express`, `cors`, `helmet`, `express-rate-limit`                  | MIT              | API server and hardening.                                     |
| `prisma`, `@prisma/client`                                         | Apache-2.0       | ORM and migrations.                                           |
| `zod`                                                              | MIT              | Input validation, shared with the web app.                    |
| `jose`                                                             | MIT              | JWT signing/verification.                                     |
| `@node-rs/argon2`                                                  | MIT              | Password hashing (Argon2id).                                  |
| `pino`                                                             | MIT              | Structured logging.                                           |
| `pg`, `pg-boss`                                                    | MIT              | PostgreSQL driver and job queue.                              |
| `intl-messageformat`                                               | BSD-3-Clause     | ICU message formatting (plurals, arguments).                  |
| `dotenv`                                                           | BSD-2-Clause     | Local `.env` loading.                                         |
| `supertest`, `vitest`, `typescript`, `eslint`, `prettier`, `turbo` | MIT / Apache-2.0 | Development and test tooling.                                 |

**shadcn/ui**: the `apps/web/src/components/ui` primitives follow the shadcn/ui
component API and conventions (MIT). The implementations here are written for this
project (smaller, no runtime theming layer); where a component is a close
derivation of the upstream source, this file is the attribution.

**Noto Sans Ethiopic** (SIL Open Font License 1.1) is referenced from Google Fonts
in `apps/web/src/app/globals.css` for development convenience. Production
deployments should self-host the font and include the OFL license text — see
`docs/DECISIONS.md` (ADR-0012).

**Noto Sans Ethiopic** static instances (Regular and Bold, Google Fonts cut with
Basic Latin coverage) are bundled at `apps/api/assets/fonts/` under the SIL Open
Font License 1.1 (`apps/api/assets/fonts/OFL.txt`) and embedded into generated
receipt PDFs — see `docs/DECISIONS.md` (ADR-0028).

**pdfkit** (MIT) renders the server-side receipt PDFs in `apps/api`. Upstream:
https://github.com/foliojs/pdfkit
